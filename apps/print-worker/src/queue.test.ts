import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createManualClock,
  createOrder,
  type Database,
  getOrder,
  getOrderItem,
  getPrintSheet,
  listPrintSlots,
  openBusinessDay,
  openDatabase,
  reprintItems,
  setPrintPaused,
  transitionOrder,
} from "@canbadge/db";
import { encodePng } from "@canbadge/fixtures";
import { createDevDriver, type PrintDriver, type PrintJob } from "./driver";
import { runQueueOnce } from "./queue";

let dir: string;
let db: Database;
let clock: ReturnType<typeof createManualClock>;
let printed: PrintJob[];
let driver: PrintDriver;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "canbadge-print-"));
  // 注文のデザイン画像（PDF に載せるので、本物の PNG が要る）
  mkdirSync(join(dir, "images"), { recursive: true });
  writeFileSync(join(dir, "images", "a.png"), encodePng(8, 8, new Uint8Array(8 * 8 * 3)));
  clock = createManualClock("2026-11-03T09:00:00+09:00");
  db = openDatabase({ path: ":memory:", now: clock.now });
  openBusinessDay(db, { actor: "staff" });
  printed = [];
  driver = {
    name: "fake",
    print: async (job) => {
      printed.push(job);
    },
  };
});
afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
});

/** 支払い済みの注文を作り、その明細の ID を返す */
function paidItem(): { orderId: string; itemId: string; orderNumber: number } {
  const { order, items } = createOrder(db, {
    imagePath: "images/a.png",
    editorData: { version: 1 },
    quantity: 1,
    anonToken: crypto.randomUUID().replaceAll("-", ""),
  });
  transitionOrder(db, { orderId: order.id, to: "paid", actor: "staff" });
  return { orderId: order.id, itemId: items[0]?.id ?? "", orderNumber: order.orderNumber };
}

const options = (extra: { slots?: number; waitOverrideSeconds?: number } = {}) => ({
  dataDir: dir,
  driver,
  ...extra,
});

describe("印刷キューの巡回", () => {
  test("印刷できるバッジがなければ empty", async () => {
    expect(await runQueueOnce(db, options())).toEqual({ status: "empty" });
  });

  test("支払い前の注文は、印刷の対象にならない", async () => {
    createOrder(db, {
      imagePath: "images/a.png",
      editorData: { version: 1 },
      quantity: 1,
      anonToken: crypto.randomUUID().replaceAll("-", ""),
    });
    expect(await runQueueOnce(db, options())).toEqual({ status: "empty" });
  });

  test("用紙 1 枚分に足りず、待ち時間にも達していなければ、待つ", async () => {
    paidItem();
    expect(await runQueueOnce(db, options({ slots: 3 }))).toEqual({ status: "waiting" });
    expect(printed).toHaveLength(0);
  });

  test("最も古いバッジが待ち時間に達したら、そのときの分で印刷する", async () => {
    const a = paidItem();
    clock.advance(121_000);
    const result = await runQueueOnce(db, options({ slots: 3 }));
    expect(result).toMatchObject({ status: "printed", orderNumbers: [a.orderNumber] });
    expect(printed).toHaveLength(1);
  });

  test("用紙 1 枚分たまれば、待たずに即座に印刷し、載らなかった分は次のシートに回す", async () => {
    const items = [paidItem(), paidItem(), paidItem()];
    const first = await runQueueOnce(db, options({ slots: 2 }));
    expect(first).toMatchObject({ status: "printed", orderNumbers: [1, 2] });
    // 印刷が終わったバッジの注文は、自動で組み立て中になる。載らなかった分は、印刷待ちのまま
    expect(getOrder(db.orm, items[0]?.orderId ?? "")?.status).toBe("assembling");
    expect(getOrderItem(db.orm, items[2]?.itemId ?? "")?.status).toBe("queued");
    // 1 個だけでは、用紙が埋まらず、待ち時間にも達していない
    expect(await runQueueOnce(db, options({ slots: 2 }))).toEqual({ status: "waiting" });

    clock.advance(121_000);
    const second = await runQueueOnce(db, options({ slots: 2 }));
    expect(second).toMatchObject({ status: "printed", orderNumbers: [3] });
  });

  test("印刷の前に、シートとバッジの状態が DB に記録されている", async () => {
    const a = paidItem();
    clock.advance(121_000);
    const seen: { sheet?: string; item?: string } = {};
    const spy: PrintDriver = {
      name: "spy",
      print: async (job) => {
        // 印刷を実行する時点で、すでに記録されている（再起動しても二重に印刷されない）
        seen.sheet = getPrintSheet(db.orm, job.sheetId)?.status;
        seen.item = getOrderItem(db.orm, a.itemId)?.status;
      },
    };
    await runQueueOnce(db, { dataDir: dir, driver: spy });
    expect(seen).toEqual({ sheet: "printing", item: "printing" });
  });

  test("PDF が作られ、シートの位置は並び順（注文番号の順）", async () => {
    paidItem();
    paidItem();
    const result = await runQueueOnce(db, options({ slots: 2 }));
    if (result.status !== "printed") throw new Error("印刷されるはずです");

    const job = printed[0];
    expect(job?.sheetId).toBe(result.sheetId);
    expect(existsSync(job?.pdfPath ?? "")).toBe(true);
    expect(
      readFileSync(job?.pdfPath ?? "")
        .subarray(0, 5)
        .toString(),
    ).toBe("%PDF-");
    // ドライバーが成功したので、印刷の確認なしで、OK になっている
    expect(listPrintSlots(db.orm, result.sheetId).map((s) => [s.position, s.result])).toEqual([
      [0, "ok"],
      [1, "ok"],
    ]);
  });

  test("再印刷のバッジが先に載る", async () => {
    const a = paidItem();
    const b = paidItem();
    await runQueueOnce(db, options({ slots: 2 }));
    // 組み立てで、b の印刷が不良だと分かって、履歴から再印刷する
    reprintItems(db, { orderItemIds: [b.itemId], actor: "staff" });
    expect(getOrderItem(db.orm, a.itemId)?.status).toBe("printed");

    const c = paidItem();
    const second = await runQueueOnce(db, options({ slots: 2 }));
    // 再印刷の b（printCount 1）が先、そのあとに新しい c
    expect(second).toMatchObject({
      status: "printed",
      orderNumbers: [b.orderNumber, c.orderNumber],
    });
  });

  test("印刷の一時停止中は、何もしない", async () => {
    paidItem();
    setPrintPaused(db, { paused: true, actor: "staff" });
    expect(await runQueueOnce(db, options({ slots: 1 }))).toEqual({ status: "paused" });
    setPrintPaused(db, { paused: false, actor: "staff" });
    expect((await runQueueOnce(db, options({ slots: 1 }))).status).toBe("printed");
  });

  test("返金済みの注文のバッジは載せない", async () => {
    const a = paidItem();
    transitionOrder(db, { orderId: a.orderId, to: "refunded", actor: "staff" });
    expect(await runQueueOnce(db, options({ slots: 1 }))).toEqual({ status: "empty" });
  });

  test("待ち時間を、引数で上書きできる（開発用）", async () => {
    paidItem();
    expect((await runQueueOnce(db, options({ slots: 3, waitOverrideSeconds: 0 }))).status).toBe(
      "printed",
    );
  });

  test("ドライバーが失敗したら、バッジは印刷待ちに戻り、シートは失敗になり、印刷は一時停止になる", async () => {
    const a = paidItem();
    const broken: PrintDriver = {
      name: "broken",
      print: async () => {
        throw new Error("プリンターがつながっていません");
      },
    };
    const result = await runQueueOnce(db, { dataDir: dir, driver: broken, slots: 1 });
    expect(result).toMatchObject({
      status: "driver-failed",
      error: "プリンターがつながっていません",
    });
    expect(getOrderItem(db.orm, a.itemId)?.status).toBe("queued");
    // 一時停止になるので、次の巡回は印刷しない（失敗し続けない）
    expect(await runQueueOnce(db, options({ slots: 1 }))).toEqual({ status: "paused" });
  });

  test("シートを作れなかったときは、PDF を残さず failed を返す", async () => {
    const a = paidItem();
    // 巡回の途中で別の操作が返金した状況を、印刷の直前に差し込む
    db.sqlite.exec(
      `CREATE TRIGGER block_printing BEFORE UPDATE ON order_items WHEN NEW.status = 'printing' BEGIN SELECT RAISE(ABORT, '載せられません'); END`,
    );
    const result = await runQueueOnce(db, options({ slots: 1 }));
    expect(result.status).toBe("failed");
    expect(getOrderItem(db.orm, a.itemId)?.status).toBe("queued");
    expect(existsSync(join(dir, "sheets")) ? readdirCount(join(dir, "sheets")) : 0).toBe(0);
  });
});

function readdirCount(path: string): number {
  return [...new Bun.Glob("*").scanSync({ cwd: path })].length;
}

describe("開発用ドライバー", () => {
  test("PDF を出力フォルダに複製する", async () => {
    const out = join(dir, "print-out");
    const dev = createDevDriver(out);
    await Bun.write(join(dir, "sheet.pdf"), "%PDF-1.4");
    await dev.print({ sheetId: "s", pdfPath: join(dir, "sheet.pdf") });
    expect(readFileSync(join(out, "sheet.pdf"), "utf8")).toBe("%PDF-1.4");
  });
});
