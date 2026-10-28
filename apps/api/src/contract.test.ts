import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { completePrintSheet, getCurrentPrintSheet } from "@canbadge/db";
import { encodePng, sampleImageIds } from "@canbadge/fixtures";
import { buildPath, type EndpointName, endpoints } from "@canbadge/shared";
import { call, createTestApp, openSse, type TestApp } from "./test-helpers";

// 契約（packages/shared の endpoints）の全エンドポイントを、サンプルデータに対して 1 本ずつ呼び、
// 応答が契約のスキーマに合うことを確かめる。契約と実装のずれは、ここで見つかる。
// エンドポイントが 1 本でも抜けていると、最後のテストが失敗する。

let t: TestApp;
beforeAll(() => {
  t = createTestApp();
});
afterAll(async () => await t.close());

/** ステップ間で受け渡す値（アップロードした画像、作った注文、Cookie など） */
const state: Record<string, string> = {};
const covered = new Set<EndpointName>();

/** 1 本のエンドポイントを呼び、JSON なら契約のスキーマで検証して、本体を返す */
async function run(
  name: EndpointName,
  request: {
    params?: Record<string, string>;
    query?: string;
    json?: unknown;
    form?: FormData;
    headers?: Record<string, string>;
  },
  expectedStatus = 200,
): Promise<{ response: Response; body: unknown }> {
  const endpoint = endpoints[name];
  const path = buildPath(endpoint.path, request.params) + (request.query ?? "");
  const response = await call(t.app, endpoint.method, path, {
    json: request.json,
    form: request.form,
    headers: request.headers,
  });
  covered.add(name);
  expect({ name, status: response.status }).toEqual({ name, status: expectedStatus });

  if (endpoint.response === null || expectedStatus !== 200) return { response, body: undefined };
  const body: unknown = await response.json();
  const checked = endpoint.response.safeParse(body);
  expect({ name, valid: checked.success }).toEqual({ name, valid: true });
  return { response, body };
}

const tinyPng = () => {
  const form = new FormData();
  form.set(
    "file",
    new File([encodePng(2, 2, new Uint8Array(12).fill(120))], "tiny.png", { type: "image/png" }),
  );
  return form;
};

describe("来場者向けのエンドポイント", () => {
  test("getStatus", async () => {
    const { body } = await run("getStatus", {});
    expect(body).toMatchObject({ acceptance: "open", price: 200, maxQuantityPerOrder: 1 });
  });

  test("uploadImage → getImage", async () => {
    const { body } = await run("uploadImage", { form: tinyPng() });
    state.uploadedImageId = (body as { imageId: string }).imageId;

    const image = await run("getImage", { params: { imageId: state.uploadedImageId } });
    expect(image.response.headers.get("content-type")).toBe("image/png");
    await run("getImage", {
      params: { imageId: sampleImageIds.rings ?? "" },
      query: "?size=thumb",
    });
  });

  test("createOrder → getOrder", async () => {
    const { response, body } = await run("createOrder", {
      json: {
        imageId: state.uploadedImageId,
        editorData: { version: 1 },
        quantity: 1,
        turnstileToken: "dummy",
        rightsConsent: true,
      },
    });
    state.newOrderId = (body as { orderId: string }).orderId;
    // 匿名トークンは、api が Cookie に入れる（画面側では作らない）
    state.cookie = (response.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
    expect(state.cookie).toMatch(/^anon_token=.{16,}/);

    await run("getOrder", { params: { orderId: state.newOrderId ?? "" } });
  });

  test("lookupOrder", async () => {
    const waiting = t.summary.orders.waiting;
    await run("lookupOrder", {
      json: { orderNumber: waiting?.orderNumber, confirmationCode: t.confirmationCode("waiting") },
    });
  });

  test("cancelOrder（本人の Cookie を持つ来場者）", async () => {
    const { body } = await run("cancelOrder", {
      params: { orderId: state.newOrderId ?? "" },
      headers: { cookie: state.cookie ?? "" },
    });
    expect(body).toMatchObject({ status: "cancelled" });
  });

  test("Discord の取り込み（W08）：設定がなければ、画面（/）に戻して、使えないと伝える（302）。詳しい動きは discord.test.ts", async () => {
    const authorize = await run("discordAuthorize", {}, 302);
    expect(authorize.response.headers.get("location")).toBe("/?discordError=unavailable");
    const callback = await run("discordCallback", { query: "?code=x&state=y" }, 302);
    expect(callback.response.headers.get("location")).toBe("/?discordError=unavailable");
  });

  test("orderEvents（SSE）", async () => {
    const sse = await openSse(
      t.app,
      buildPath(endpoints.orderEvents.path, { orderId: t.orderId("waiting") }),
    );
    expect(sse.response.headers.get("content-type")).toContain("text/event-stream");
    covered.add("orderEvents");
    await sse.close();
  });
});

describe("スタッフ向けのエンドポイント", () => {
  test("searchStaffOrders", async () => {
    const { body } = await run("searchStaffOrders", { query: "?status=ready,assembling&limit=5" });
    const items = (body as { items: { status: string }[] }).items;
    expect(items.length).toBeGreaterThan(0);
    for (const item of items) expect(["ready", "assembling"]).toContain(item.status);
  });

  test("支払い → 完成 → 受け渡し → 返金 → 取り消し（組み立て開始の操作は、ない）", async () => {
    const pay = await run("payOrder", { params: { orderId: t.orderId("waiting") } });
    expect(pay.body).toMatchObject({ status: "paid" });
    const complete = await run("completeOrder", { params: { orderId: t.orderId("assembling") } });
    expect(complete.body).toMatchObject({ status: "ready" });
    const pickup = await run("pickupOrder", {
      params: { orderId: t.orderId("readyNew") },
      json: { confirmationCode: t.confirmationCode("readyNew") },
    });
    expect(pickup.body).toMatchObject({ status: "picked_up" });
    const refund = await run("refundOrder", { params: { orderId: t.orderId("queued") } });
    expect(refund.body).toMatchObject({ status: "refunded" });
    const cancel = await run("cancelStaffOrder", {
      params: { orderId: t.orderId("waitingFromArchive") },
    });
    expect(cancel.body).toMatchObject({ status: "cancelled" });
  });

  test("印刷：現在のシート → 履歴 → PDF（印刷の確認の操作は、ない）", async () => {
    const current = await run("getCurrentPrintSheet", {});
    const sheet = (
      current.body as { sheet: { id: string; status: string; slots: unknown[] } | null }
    ).sheet;
    expect(sheet?.status).toBe("printing");
    expect(sheet?.slots).toHaveLength(2);
    state.sheetId = sheet?.id ?? "";

    const history = await run("listPrintSheets", { query: "?limit=2" });
    expect((history.body as { items: unknown[] }).items).toHaveLength(2);

    const pdf = await run("getPrintSheetPdf", { params: { sheetId: state.sheetId ?? "" } });
    expect(pdf.response.headers.get("content-type")).toBe("application/pdf");
    expect(new TextDecoder().decode((await pdf.response.arrayBuffer()).slice(0, 5))).toBe("%PDF-");
  });

  test("印刷済みバッジの一覧 → 再印刷", async () => {
    const list = await run("listPrintedItems", { query: "?limit=30" });
    const items = (list.body as { items: { reprintable: boolean }[] }).items;
    expect(items.some((item) => item.reprintable)).toBe(true);

    const reprint = await run("reprint", { json: { orderItemIds: [t.itemId("printedB")] } });
    expect(reprint.body).toEqual({ reprintedItemIds: [t.itemId("printedB")], skippedItemIds: [] });
  });

  test("印刷の一時停止と再開", async () => {
    expect((await run("pausePrintQueue", {})).body).toEqual({ printPaused: true });
    expect((await run("resumePrintQueue", {})).body).toEqual({ printPaused: false });
  });

  test("営業開始・受付状態・設定・売上", async () => {
    await run("openBusinessDay", {});
    const settings = await run("getSettings", {});
    const current = settings.body as Record<string, unknown>;
    const updated = await run("updateSettings", {
      json: {
        price: 350,
        kiraFilmPrice: current.kiraFilmPrice,
        magnetPrice: current.magnetPrice,
        badgeStock: current.badgeStock,
        kiraFilmStock: current.kiraFilmStock,
        magnetStock: current.magnetStock,
        maxQuantityPerOrder: current.maxQuantityPerOrder,
        maxPendingPerDevice: current.maxPendingPerDevice,
        printMaxWaitSeconds: current.printMaxWaitSeconds,
        orderNumberDigits: current.orderNumberDigits,
        imageMaxBytes: current.imageMaxBytes,
      },
    });
    expect(updated.body).toMatchObject({ price: 350 });

    const busy = await run("setAcceptance", {
      json: { acceptance: "busy", busyMessage: "しばらくお待ちください" },
    });
    expect(busy.body).toMatchObject({ acceptance: "busy", busyMessage: "しばらくお待ちください" });

    // 営業開始で、営業日はいまの日付になった。サンプルの営業日（2026-11-03）を指定して集計する
    const sales = await run("getSales", { query: "?businessDate=2026-11-03" });
    expect((sales.body as { total: { paidCount: number } }).total.paidCount).toBeGreaterThan(0);
  });

  test("staffEvents（SSE）", async () => {
    const sse = await openSse(t.app, endpoints.staffEvents.path);
    covered.add("staffEvents");
    expect(sse.response.headers.get("content-type")).toContain("text/event-stream");
    await sse.close();
  });
});

describe("呼び出しモニター向けのエンドポイント", () => {
  test("getMonitorReady", async () => {
    const { body } = await run("getMonitorReady", {});
    const items = (body as { items: { orderNumberText: string }[] }).items;
    expect(items.length).toBeGreaterThan(0);
    expect(items[0]?.orderNumberText).toMatch(/^\d{3}$/);
  });

  test("monitorEvents（SSE）", async () => {
    const sse = await openSse(t.app, endpoints.monitorEvents.path);
    covered.add("monitorEvents");
    expect(sse.response.headers.get("content-type")).toContain("text/event-stream");
    await sse.close();
  });
});

describe("アーカイブのエンドポイント（A04）", () => {
  const post = (displayName: string) => ({
    imageId: state.uploadedImageId,
    editorData: { version: 1 },
    displayName,
    consent: { selfMade: true, allowOthersToOrder: true },
  });
  const author = () => ({ cookie: state.cookie ?? "" });

  test("createArchiveEntry → listMyArchive → listStaffArchive（審査待ち）", async () => {
    const { body } = await run("createArchiveEntry", { json: post("たろう"), headers: author() });
    state.entryA = (body as { entryId: string }).entryId;

    const mine = await run("listMyArchive", { headers: author() });
    expect(mine.body).toMatchObject({ items: [{ id: state.entryA, status: "pending_review" }] });

    const staff = await run("listStaffArchive", { query: "?status=pending_review" });
    expect(JSON.stringify(staff.body)).toContain(state.entryA ?? "");
  });

  test("approveArchiveEntry → listArchive・getArchiveEntry（公開）", async () => {
    await run("approveArchiveEntry", { params: { entryId: state.entryA ?? "" } });
    const list = await run("listArchive", {});
    expect(JSON.stringify(list.body)).toContain(state.entryA ?? "");
    await run("getArchiveEntry", { params: { entryId: state.entryA ?? "" } });
  });

  test("reportArchiveEntry → listArchiveReports → resolveArchiveReport", async () => {
    const { body } = await run("reportArchiveEntry", {
      params: { entryId: state.entryA ?? "" },
      json: { reason: "他人のキャラクターに見えます" },
    });
    const reportId = (body as { reportId: string }).reportId;
    const list = await run("listArchiveReports", { query: "?status=open" });
    expect(JSON.stringify(list.body)).toContain(reportId);
    await run("resolveArchiveReport", { params: { reportId } });
  });

  test("orderFromArchive（作品をコピーして注文）", async () => {
    // 前のテストで受付を止めているので、開ける（作品からの注文も、受付状態に従う）
    await call(t.app, "POST", "/api/staff/business-day/open");
    await call(t.app, "POST", "/api/staff/acceptance", { json: { acceptance: "open" } });
    await run("orderFromArchive", {
      params: { entryId: state.entryA ?? "" },
      json: { quantity: 1, turnstileToken: "dummy", rightsConsent: true },
    });
  });

  test("hideArchiveEntry（スタッフが非公開に）・rejectArchiveEntry・withdrawArchiveEntry（作者の取り下げ）", async () => {
    const hidden = await run("hideArchiveEntry", { params: { entryId: state.entryA ?? "" } });
    expect(hidden.body).toMatchObject({ status: "hidden" });

    const rejected = await run("createArchiveEntry", { json: post("はなこ"), headers: author() });
    const rejectedId = (rejected.body as { entryId: string }).entryId;
    const r = await run("rejectArchiveEntry", { params: { entryId: rejectedId } });
    expect(r.body).toMatchObject({ status: "rejected" });

    const own = await run("createArchiveEntry", { json: post("じろう"), headers: author() });
    const ownId = (own.body as { entryId: string }).entryId;
    await run("approveArchiveEntry", { params: { entryId: ownId } });
    const withdrawn = await run("withdrawArchiveEntry", {
      params: { entryId: ownId },
      headers: author(),
    });
    expect(withdrawn.body).toMatchObject({ status: "hidden" });
  });
});

// サンプルデータを消すので、ほかのテストのあと（契約との対応の直前）に置く
describe("イベントデータのリセット", () => {
  test("getResetSummary：受付が終了していなければ、実行できない理由が出る", async () => {
    const { body } = await run("getResetSummary", {});
    const summary = body as { counts: { orders: number }; blockers: string[] };
    expect(summary.counts.orders).toBeGreaterThan(0);
    expect(summary.blockers).toContain("acceptance_not_closed");
  });

  test("resetEventData：確認の文字が違えば 400、受付が終了していなければ 409。どちらも、何も消えない", async () => {
    await run("resetEventData", { json: { confirm: "reset" } }, 400);
    await run("resetEventData", { json: {} }, 400);
    await run("resetEventData", { json: { confirm: "リセット" } }, 409);
    const { body } = await run("getResetSummary", {});
    expect((body as { counts: { orders: number } }).counts.orders).toBeGreaterThan(0);
  });

  test("resetEventData：受付を終了して、確認の文字を送ると、消える", async () => {
    await run("setAcceptance", { json: { acceptance: "closed" } });
    // サンプルには、印刷中のまま残ったシートがある。印刷中は、リセットできない（先に、印刷を済ませる）
    expect(((await run("getResetSummary", {})).body as { blockers: string[] }).blockers).toEqual([
      "print_sheet_printing",
    ]);
    await run("resetEventData", { json: { confirm: "リセット" } }, 409);
    const printing = getCurrentPrintSheet(t.db);
    if (printing) completePrintSheet(t.db, { sheetId: printing.id });

    const { body } = await run("resetEventData", { json: { confirm: "リセット" } });
    const result = body as { backupName: string; deleted: { orders: number } };
    expect(result.backupName).toMatch(/^old-\d{8}-\d{6}$/);
    expect(result.deleted.orders).toBeGreaterThan(0);

    const after = await run("getResetSummary", {});
    expect(after.body).toMatchObject({
      acceptance: "closed",
      counts: { orders: 0, unfinishedOrders: 0, printSheets: 0, archiveEntries: 0, reports: 0 },
      blockers: [],
    });
    expect((await run("getSettings", {})).body).toMatchObject({ businessDate: null });
  });
});

describe("契約との対応", () => {
  test("契約のすべてのエンドポイントを、1 本ずつ呼んで確かめた", () => {
    expect([...covered].map(String).sort()).toEqual(Object.keys(endpoints).sort());
  });
});
