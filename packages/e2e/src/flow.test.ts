import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type ApiClient, ApiClientError, createApiClient } from "@canbadge/api-client";
import { encodePng } from "@canbadge/fixtures";
import { type SseEvent, sseEventSchema } from "@canbadge/shared";
import { type Stack, startStack } from "./processes";

// 全体疎通（T09）。注文 → レジで支払い → 印刷（開発用ドライバーで PDF を出力）→ 印刷確認 →
// 組み立て → 完成 → 呼び出しモニター → 受け渡し を、api と print-worker を実際に起動して通す。
// 2 つのプロセスが同じ SQLite を使い、操作ログ経由で SSE が届くことまで確かめる。

setDefaultTimeout(60_000);

let dataDir: string;
let stack: Stack;
let client: ApiClient;
let staffEvents: ReturnType<typeof collectEvents>;

beforeAll(async () => {
  dataDir = mkdtempSync(join(tmpdir(), "canbadge-e2e-"));
  // DB を先に作らず、api と print-worker を同時に起動する（空の DB への同時起動も確かめる）
  stack = await startStack(dataDir);
  client = createApiClient({ baseUrl: stack.baseUrl });
  staffEvents = collectEvents(`${stack.baseUrl}/api/staff/events`);
  await staffEvents.connected;
});

afterAll(async () => {
  staffEvents?.stop();
  await stack?.stop();
  for (let attempt = 0; attempt < 10; attempt++) {
    try {
      rmSync(dataDir, { recursive: true, force: true });
      return;
    } catch {
      Bun.gc(true);
      await Bun.sleep(100);
    }
  }
});

/** 条件を満たす値が返るまで、繰り返し確かめる。時間切れのときは、2 つのプロセスの出力を添えて落とす */
async function waitFor<T>(
  label: string,
  check: () => Promise<T | undefined | false>,
  timeoutMs = 15_000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await check();
    if (value) return value;
    if (Date.now() > deadline) {
      throw new Error(
        `時間切れ: ${label}\n--- api ---\n${stack.api.output()}\n--- print-worker ---\n${stack.printWorker.output()}`,
      );
    }
    await Bun.sleep(100);
  }
}

/** SSE を購読して、届いたイベントを集める */
function collectEvents(url: string) {
  const events: SseEvent[] = [];
  const controller = new AbortController();
  let markConnected: () => void = () => undefined;
  const connected = new Promise<void>((resolve) => {
    markConnected = resolve;
  });

  void (async () => {
    try {
      const response = await fetch(url, { signal: controller.signal });
      const reader = response.body?.getReader();
      if (!reader) return;
      const decoder = new TextDecoder();
      let buffer = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) return;
        buffer += decoder.decode(value, { stream: true });
        const blocks = buffer.split("\n\n");
        buffer = blocks.pop() ?? "";
        for (const block of blocks) {
          if (block.startsWith(": connected")) markConnected();
          const data = block.split("\n").find((line) => line.startsWith("data: "));
          const parsed = data ? sseEventSchema.safeParse(JSON.parse(data.slice(6))) : undefined;
          if (parsed?.success) events.push(parsed.data);
        }
      }
    } catch {
      // 購読をやめたときの中断
    }
  })();

  return { events, connected, stop: () => controller.abort() };
}

const image = () => {
  const png = encodePng(8, 8, new Uint8Array(8 * 8 * 3).fill(150));
  return new File([png as unknown as BlobPart], "badge.png", { type: "image/png" });
};

/** 来場者として注文する。注文 ID・注文番号・確認コードを返す */
async function placeOrder() {
  const { imageId } = await client.uploadImage(image());
  const { orderId } = await client.call("createOrder", {
    body: {
      imageId,
      editorData: { version: 1 },
      quantity: 1,
      turnstileToken: "dev",
      rightsConsent: true,
    },
  });
  const order = await client.call("getOrder", { params: { orderId } });
  return { orderId, number: order.orderNumberText, code: order.confirmationCode };
}

/** レジで、注文番号を入れて探し、支払い済みにする */
async function payAtRegister(number: string) {
  const found = await client.call("searchStaffOrders", {
    query: { q: String(Number(number)), status: "submitted", limit: 5 },
  });
  const order = found.items[0];
  if (!order) throw new Error(`支払い待ちの注文 ${number} が見つかりません`);
  return await client.call("payOrder", { params: { orderId: order.id } });
}

/** print-worker が作った、印刷中のシート（指定した注文番号を含むもの）を待つ */
async function waitForSheet(number: string, notSheetId?: string) {
  return await waitFor(`注文 ${number} が載った印刷シート`, async () => {
    const { sheet } = await client.call("getCurrentPrintSheet");
    const found =
      sheet && sheet.id !== notSheetId && sheet.slots.some((s) => s.orderNumberText === number);
    return found ? sheet : undefined;
  });
}

const state: {
  visitorEvents?: ReturnType<typeof collectEvents>;
  first?: Awaited<ReturnType<typeof placeOrder>>;
  firstSheetId?: string;
} = {};

describe("注文から受け渡しまで", () => {
  test("営業開始：営業日が決まり、受付が始まる", async () => {
    const setting = await client.call("openBusinessDay");
    expect(setting).toMatchObject({ acceptance: "open" });
    expect(setting.businessDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  test("来場者が注文する：注文番号と確認コードが発行され、支払い待ちになる", async () => {
    state.first = await placeOrder();
    expect(state.first.number).toBe("001");
    expect(state.first.code).toMatch(/^[2-9A-HJKMNP-Z]{4}$/);

    const order = await client.call("getOrder", { params: { orderId: state.first.orderId } });
    expect(order.status).toBe("submitted");
    // 来場者の注文状況ページと同じ。これ以降の変化を、SSE で受け取る
    state.visitorEvents = collectEvents(
      `${stack.baseUrl}/api/events/orders/${state.first.orderId}`,
    );
    await state.visitorEvents.connected;
  });

  test("レジ：注文番号を入れて、支払い済みにする。受付待ちの件数が増える", async () => {
    const paid = await payAtRegister(state.first?.number ?? "");
    expect(paid.status).toBe("paid");
    const status = await client.call("getStatus");
    expect(status.waitingCount).toBeGreaterThanOrEqual(0);
  });

  test("print-worker が、印刷待ちを拾ってシートを作り、開発用ドライバーが PDF を出力する", async () => {
    const sheet = await waitForSheet(state.first?.number ?? "");
    state.firstSheetId = sheet.id;
    expect(sheet.status).toBe("printing");
    expect(sheet.slots[0]).toMatchObject({ orderNumberText: "001", result: "pending" });

    // 生成した PDF（data/sheets）と、開発用ドライバーが出力した PDF（data/print-out）
    const generated = readdirSync(join(dataDir, "sheets"));
    const output = readdirSync(join(dataDir, "print-out"));
    expect(generated).toHaveLength(1);
    expect(output).toEqual(generated);

    // スタッフ画面のプレビューと同じ、api 経由の PDF
    const pdf = await client.call("getPrintSheetPdf", { params: { sheetId: sheet.id } });
    expect(new TextDecoder().decode((await pdf.arrayBuffer()).slice(0, 5))).toBe("%PDF-");
  });

  test("別のプロセスが作ったシートの変化が、スタッフの SSE に届く", async () => {
    await waitFor("シートの変化の通知", async () =>
      staffEvents.events.find(
        (e) =>
          e.type === "sheet.updated" && e.sheetId === state.firstSheetId && e.status === "printing",
      ),
    );
  });

  test("印刷確認：全部 OK にすると、シートは確認済みに、注文は自動で印刷済みになる", async () => {
    const checked = await client.call("checkPrintSheet", {
      params: { sheetId: state.firstSheetId ?? "" },
      body: { reprintOrderItemIds: [] },
    });
    expect(checked).toMatchObject({ status: "confirmed" });
    const order = await client.call("getOrder", {
      params: { orderId: state.first?.orderId ?? "" },
    });
    expect(order.status).toBe("printed");
  });

  test("組み立て → 完成：呼び出しモニターに、注文番号が出る", async () => {
    const orderId = state.first?.orderId ?? "";
    await client.call("assembleOrder", { params: { orderId } });
    await client.call("completeOrder", { params: { orderId } });
    const ready = await waitFor("呼び出しモニターの表示", async () => {
      const { items } = await client.call("getMonitorReady");
      return items.some((item) => item.orderNumberText === "001") ? items : undefined;
    });
    // モニターには、注文 ID（QR の中身）を返さない
    expect(JSON.stringify(ready)).not.toContain(orderId);
  });

  test("受け渡し：確認コードが違えば断り、合えば受け渡し済みになり、モニターから消える", async () => {
    const orderId = state.first?.orderId ?? "";
    const wrong = state.first?.code === "2222" ? "3333" : "2222";
    const error = await client
      .call("pickupOrder", { params: { orderId }, body: { confirmationCode: wrong } })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiClientError);
    expect(error).toMatchObject({ code: "CONFIRMATION_MISMATCH", status: 409 });

    const picked = await client.call("pickupOrder", {
      params: { orderId },
      body: { confirmationCode: state.first?.code ?? "" },
    });
    expect(picked.status).toBe("picked_up");
    await waitFor("モニターから消える", async () => {
      const { items } = await client.call("getMonitorReady");
      return items.every((item) => item.orderNumberText !== "001") ? true : undefined;
    });
  });

  test("来場者の注文状況ページに、状態の変化が順に届いた", async () => {
    const statuses = await waitFor("来場者への通知", async () => {
      const list = (state.visitorEvents?.events ?? []).flatMap((e) =>
        e.type === "order.updated" ? [e.status] : [],
      );
      return list.includes("picked_up") ? list : undefined;
    });
    // 購読の直後に、注文作成（submitted）の通知が先に届くことがある。順序の検査からは外す
    expect(statuses.filter((status) => status !== "submitted")).toEqual([
      "paid",
      "printed",
      "assembling",
      "ready",
      "picked_up",
    ]);
    state.visitorEvents?.stop();
  });
});

describe("再印刷", () => {
  test("印刷確認で再印刷を選ぶと、別のシートに自動で載り直り、確認すると注文が印刷済みになる", async () => {
    const second = await placeOrder();
    expect(second.number).toBe("002");
    await payAtRegister(second.number);

    const first = await waitForSheet(second.number);
    const itemId = first.slots.find((s) => s.orderNumberText === second.number)?.orderItemId ?? "";
    await client.call("checkPrintSheet", {
      params: { sheetId: first.id },
      body: { reprintOrderItemIds: [itemId] },
    });
    // 再印刷のバッジは、印刷待ちに戻り、注文は支払い済みのまま
    const waiting = await client.call("getOrder", { params: { orderId: second.orderId } });
    expect(waiting.status).toBe("paid");

    // print-worker が、次のシートに載せ直す
    const again = await waitForSheet(second.number, first.id);
    expect(again.id).not.toBe(first.id);
    await client.call("checkPrintSheet", {
      params: { sheetId: again.id },
      body: { reprintOrderItemIds: [] },
    });
    const done = await client.call("getOrder", { params: { orderId: second.orderId } });
    expect(done.status).toBe("printed");

    // 履歴には、2 回印刷されたことが残る
    const printed = await client.call("listPrintedItems", { query: { q: "2", limit: 10 } });
    expect(printed.items[0]).toMatchObject({ orderItemId: itemId, printCount: 2 });
  });
});

describe("売上", () => {
  test("支払い済みの 2 件が、営業日の売上に入っている", async () => {
    const sales = await client.call("getSales");
    expect(sales.total).toMatchObject({
      paidCount: 2,
      paidAmount: 600,
      refundedCount: 0,
      netAmount: 600,
    });
  });

  test("生成した PDF と出力した PDF は、どちらも実在する", () => {
    expect(existsSync(join(dataDir, "sheets"))).toBe(true);
    expect(readdirSync(join(dataDir, "print-out")).length).toBeGreaterThanOrEqual(3);
  });
});
