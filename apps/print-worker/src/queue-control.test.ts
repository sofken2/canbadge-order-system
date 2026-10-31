import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  completePrintSheet,
  createManualClock,
  createOrder,
  createPrintSheet,
  type Database,
  getCurrentPrintSheet,
  getOrder,
  getOrderItem,
  getSetting,
  listAuditLogsSince,
  listPrintSheets,
  listPrintSlots,
  openBusinessDay,
  openDatabase,
  reprintItems,
  requestPrintFlush,
  setPrintPaused,
  transitionOrder,
  updateSetting,
} from "@canbadge/db";
import { encodePng } from "@canbadge/fixtures";
import type { PrintDriver, PrintJob } from "./driver";
import { contentOf, imageDraws } from "./pdf-test-utils";
import {
  createFlushWatcher,
  createSkipRegistry,
  runQueueOnce,
  SKIP_COOLDOWN_MS,
  startQueueLoop,
} from "./queue";
import { recoverOnStartup } from "./recovery";

// 印刷キューの制御（P02）：個数・載せられないバッジ・一時停止・同時に 1 枚・再起動・停止。

let dir: string;
let db: Database;
let clock: ReturnType<typeof createManualClock>;
let printed: PrintJob[];
let driver: PrintDriver;

const png = () => encodePng(8, 8, new Uint8Array(8 * 8 * 3));
/** 1 注文ごとに別の端末として扱う（端末あたりの支払い待ちの上限に、当たらないように） */
const token = () => crypto.randomUUID().replaceAll("-", "");

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "canbadge-queue-"));
  mkdirSync(join(dir, "images"), { recursive: true });
  writeFileSync(join(dir, "images", "a.png"), png());
  clock = createManualClock("2026-11-03T09:00:00+09:00");
  db = openDatabase({ path: ":memory:", now: clock.now });
  openBusinessDay(db, { actor: "staff" });
  // 1 注文の個数の上限を 3 にする（個数のあるバッジを試すため）
  updateSetting(db, {
    actor: "staff",
    values: {
      price: 300,
      kiraFilmPrice: 100,
      magnetPrice: 100,
      badgeStock: 300,
      kiraShardsStock: 100,
      kiraAuroraStock: 100,
      magnetStock: 100,
      maxQuantityPerOrder: 3,
      maxPendingPerDevice: 5,
      printMaxWaitSeconds: 60,
      orderNumberDigits: 3,
      imageMaxBytes: 10_000_000,
    },
  });
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

/** 支払い済みの注文を作る */
function paid(options: { quantity?: number; image?: string } = {}) {
  const { order, items } = createOrder(db, {
    imagePath: options.image ?? "images/a.png",
    editorData: { version: 1 },
    quantity: options.quantity ?? 1,
    anonToken: token(),
  });
  transitionOrder(db, { orderId: order.id, to: "paid", actor: "staff" });
  return { orderId: order.id, itemId: items[0]?.id ?? "", orderNumber: order.orderNumber };
}

const run = (extra: Partial<Parameters<typeof runQueueOnce>[1]> = {}) =>
  runQueueOnce(db, { dataDir: dir, driver, waitOverrideSeconds: 0, ...extra });

/** 「印刷から外した」操作ログ */
const skipLogs = () =>
  listAuditLogsSince(db, 0)
    .map((entry) => entry.log)
    .filter((log) => log.action === "print.skip");

/** いちばん新しいシート（印刷が終わると、シートは自動で確認済みになるので、印刷中とは限らない） */
const lastSheet = () => listPrintSheets(db, { limit: 1 }).items[0];

describe("個数のあるバッジ", () => {
  test("個数の分だけ、用紙の枠を使う。位置は、最初の 1 個の位置", async () => {
    const two = paid({ quantity: 2 });
    const singles = [paid(), paid(), paid(), paid()];
    const result = await run({ waitOverrideSeconds: 9999 });
    // 2 + 1×4 = 6 個で、枠がちょうど埋まる。待ち時間に関係なく、すぐ印刷される
    expect(result.status).toBe("printed");
    const sheet = lastSheet();
    const slots = listPrintSlots(db.orm, sheet?.id ?? "");
    expect(slots.map((s) => [s.position, s.orderItemId])).toEqual([
      [0, two.itemId],
      ...singles.map((single, index) => [index + 2, single.itemId]),
    ]);
  });

  test("残りの枠に収まらないバッジは、次のシートに回り、後ろの収まるバッジが先に載る", async () => {
    const a = paid({ quantity: 3 });
    const b = paid({ quantity: 3 });
    const c = paid({ quantity: 3 });
    const d = paid();
    await run({ waitOverrideSeconds: 9999 });
    // a(3) + b(3) = 6 で埋まる。c は収まらない
    const first = listPrintSlots(db.orm, lastSheet()?.id ?? "");
    expect(first.map((s) => s.orderItemId)).toEqual([a.itemId, b.itemId]);

    await run();
    const second = listPrintSlots(db.orm, lastSheet()?.id ?? "");
    // 回された c が先頭。続けて d（3 + 1 = 4 個。足りないが、待ち時間 0 で、そのまま印刷する）
    expect(second.map((s) => s.orderItemId)).toEqual([c.itemId, d.itemId]);
  });

  test("PDF にも、個数の分だけ、同じバッジが並ぶ（画像の描画の数で確かめる）", async () => {
    paid({ quantity: 3 });
    paid();
    await run();
    const job = printed[0];
    const content = await contentOf(
      new Uint8Array(await Bun.file(job?.pdfPath ?? "").arrayBuffer()),
    );
    // 3 個 + 1 個 = 4 個の画像
    expect(imageDraws(content)).toHaveLength(4);
  });
});

describe("載せられないバッジ", () => {
  test("画像が読めないバッジは外し、ほかのバッジの印刷は止めない。操作ログに残る", async () => {
    const bad = paid({ image: "images/missing.png" });
    const goods = [paid(), paid()];
    const logs: string[] = [];
    const result = await run({ log: (m) => logs.push(m) });

    expect(result.status).toBe("printed");
    expect(result.skipped).toEqual([
      expect.objectContaining({ orderItemId: bad.itemId, orderNumber: bad.orderNumber }),
    ]);
    expect(result.skipped?.[0]?.reason).toContain("画像が見つかりません");
    const slots = listPrintSlots(db.orm, lastSheet()?.id ?? "");
    expect(slots.map((s) => s.orderItemId)).toEqual(goods.map((g) => g.itemId));
    // 外したバッジは、印刷待ちのまま
    expect(getOrderItem(db.orm, bad.itemId)?.status).toBe("queued");
    expect(
      logs.some((m) => m.includes(`注文 ${bad.orderNumber}`) && m.includes("外しました")),
    ).toBe(true);
    const audit = skipLogs();
    expect(audit).toHaveLength(1);
    expect(audit[0]?.targetId).toBe(bad.itemId);
  });

  test("PNG・JPEG でない、壊れた画像も、外す（先頭の数バイトだけでなく、実際に読めるかを確かめる）", async () => {
    writeFileSync(join(dir, "images", "note.txt"), "画像ではありません");
    // PNG の先頭だけがあって、中身が壊れている
    writeFileSync(
      join(dir, "images", "broken.png"),
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]),
    );
    const a = paid({ image: "images/note.txt" });
    const b = paid({ image: "images/broken.png" });
    const good = paid();
    const result = await run();
    expect(result.status).toBe("printed");
    expect(result.skipped?.map((s) => s.orderItemId).sort()).toEqual([a.itemId, b.itemId].sort());
    expect(listPrintSlots(db.orm, lastSheet()?.id ?? "").map((s) => s.orderItemId)).toEqual([
      good.itemId,
    ]);
  });

  test("外したバッジを、巡回のたびに記録し直さない。しばらくたつと、もう一度、確かめる（画像が直された）", async () => {
    const bad = paid({ image: "images/later.png" });
    const skips = createSkipRegistry();
    const first = await run({ skips });
    expect(first.status).toBe("empty");
    expect(first.skipped).toHaveLength(1);

    // すぐ次の巡回：もう確かめない（記録も、ログも増えない）
    const second = await run({ skips });
    expect(second.skipped).toBeUndefined();
    expect(skipLogs()).toHaveLength(1);

    // 画像が直され、時間がたつと、載る
    writeFileSync(join(dir, "images", "later.png"), png());
    clock.advance(SKIP_COOLDOWN_MS + 1000);
    const third = await run({ skips });
    expect(third.status).toBe("printed");
    expect(listPrintSlots(db.orm, lastSheet()?.id ?? "").map((s) => s.orderItemId)).toEqual([
      bad.itemId,
    ]);
  });

  test("1 枚に載る数より多い個数のバッジは、外す（どのシートにも載らない）", async () => {
    const big = paid({ quantity: 3 });
    const small = paid();
    const result = await run({ slots: 2 });
    expect(result.skipped?.[0]).toMatchObject({ orderItemId: big.itemId });
    expect(result.skipped?.[0]?.reason).toContain("1 枚に載る数");
    expect(result.status).toBe("printed");
    expect(listPrintSlots(db.orm, lastSheet()?.id ?? "").map((s) => s.orderItemId)).toEqual([
      small.itemId,
    ]);
  });
});

describe("一時停止と再開", () => {
  test("一時停止中は、シートを作らない。再開すると、印刷される", async () => {
    paid();
    setPrintPaused(db, { paused: true, actor: "staff" });
    expect(await run()).toEqual({ status: "paused" });
    expect(lastSheet()).toBeUndefined();
    expect(printed).toHaveLength(0);

    setPrintPaused(db, { paused: false, actor: "staff" });
    expect((await run()).status).toBe("printed");
    expect(printed).toHaveLength(1);
  });

  test("一時停止にしても、すでに印刷が終わったシートは、そのまま（注文は組み立て中）", async () => {
    const a = paid();
    await run();
    setPrintPaused(db, { paused: true, actor: "staff" });
    expect(getOrderItem(db.orm, a.itemId)?.status).toBe("printed");
    expect(getOrder(db.orm, a.orderId)?.status).toBe("assembling");
  });
});

describe("緊急印刷", () => {
  test("依頼がなければ待ち、依頼があれば、待ち時間を待たずに印刷する。印刷待ちが空になったら終わる", async () => {
    paid();
    const watcher = createFlushWatcher(db);
    // 1 個だけで、待ち時間（60 秒）に達していない
    expect(watcher.check()).toBe(false);
    expect((await run({ waitOverrideSeconds: 60 })).status).toBe("waiting");

    requestPrintFlush(db, { actor: "staff" });
    expect(watcher.check()).toBe(true);
    const result = await run({ waitOverrideSeconds: 0 });
    expect(result.status).toBe("printed");
    watcher.done(result);
    expect(watcher.check()).toBe(true);

    const empty = await run({ waitOverrideSeconds: 0 });
    expect(empty.status).toBe("empty");
    watcher.done(empty);
    expect(watcher.check()).toBe(false);

    // 次の注文は、また待つ
    paid();
    expect((await run({ waitOverrideSeconds: 60 })).status).toBe("waiting");
  });

  test("起動する前の依頼では、印刷しない", () => {
    requestPrintFlush(db, { actor: "staff" });
    expect(createFlushWatcher(db).check()).toBe(false);
  });

  test("印刷を止めているときは、依頼を断る", () => {
    setPrintPaused(db, { paused: true, actor: "staff" });
    expect(() => requestPrintFlush(db, { actor: "staff" })).toThrow("印刷を止めています");
  });
});

describe("同時に印刷中にできるのは 1 枚", () => {
  test("印刷中のシートがあるうちは、次のシートは作らない。終われば、次が印刷される", async () => {
    // 別の worker が、印刷のジョブを送っている最中（シートは印刷中）
    const a = paid();
    const other = createPrintSheet(db, { pdfPath: "sheets/other.pdf", orderItemIds: [a.itemId] });
    paid();
    expect(await run()).toEqual({ status: "busy" });
    expect(printed).toHaveLength(0);

    completePrintSheet(db, { sheetId: other.sheet.id });
    expect((await run()).status).toBe("printed");
    expect(printed).toHaveLength(1);
  });

  test("2 つの巡回が、同時に動いても、シートは 1 枚だけ（db が保証する）", async () => {
    paid();
    paid();
    const [a, b] = await Promise.all([run(), run()]);
    const statuses = [a.status, b.status].sort();
    expect(statuses).toEqual(["failed", "printed"]);
    expect(printed).toHaveLength(1);
    // 負けたほうの PDF は、残らない
    expect([a, b].find((r) => r.status === "failed")).toBeDefined();
  });
});

describe("再起動と、印刷の失敗", () => {
  test("シートを記録したあと、印刷の前に落ちても、再起動で、自動では印刷し直さない", async () => {
    const a = paid();
    // 落ちた worker が、シートを記録して、印刷に進む前に終わった状態
    createPrintSheet(db, { pdfPath: "sheets/crashed.pdf", orderItemIds: [a.itemId] });

    expect(await run()).toEqual({ status: "busy" });
    expect(printed).toHaveLength(0);
    // バッジは、印刷中のまま（印刷待ちに戻していない）
    expect(getOrderItem(db.orm, a.itemId)?.status).toBe("printing");
  });

  test("起動時に、印刷中のまま残ったシートは、印刷済みとして扱い（注文は組み立て中）、自動では印刷し直さないことを知らせる", () => {
    const a = paid();
    createPrintSheet(db, { pdfPath: "sheets/waiting.pdf", orderItemIds: [a.itemId] });
    const messages = recoverOnStartup(db);
    expect(messages[0]).toContain("印刷済みとして扱いました");
    expect(messages[0]).toContain("印刷し直しません");
    expect(getOrderItem(db.orm, a.itemId)?.status).toBe("printed");
    expect(getOrder(db.orm, a.orderId)?.status).toBe("assembling");
    expect(getCurrentPrintSheet(db)).toBeUndefined();
  });

  test("印刷中のシートがなければ、何も知らせない", () => {
    expect(recoverOnStartup(db)).toEqual([]);
  });

  test("ドライバーが失敗したら、バッジは印刷待ちに戻り、シートは失敗になり、印刷は一時停止になる（失敗し続けない）", async () => {
    const a = paid();
    let calls = 0;
    const failing: PrintDriver = {
      name: "failing",
      print: async () => {
        calls += 1;
        throw new Error("プリンターが応答しません");
      },
    };
    const logs: string[] = [];
    const result = await run({ driver: failing, log: (m) => logs.push(m) });
    expect(result.status).toBe("driver-failed");
    expect(logs.some((m) => m.includes("一時停止") && m.includes("再開"))).toBe(true);
    expect(getOrderItem(db.orm, a.itemId)?.status).toBe("queued");
    expect(lastSheet()?.status).toBe("failed");
    expect(getSetting(db.orm).printPaused).toBe(true);

    // 次の巡回は、一時停止（ドライバーを、もう一度呼ばない）。再開すると、印刷待ちのバッジが印刷される
    expect(await run({ driver: failing })).toEqual({ status: "paused" });
    expect(calls).toBe(1);
    setPrintPaused(db, { paused: false, actor: "staff" });
    expect((await run()).status).toBe("printed");
    expect(getOrder(db.orm, a.orderId)?.status).toBe("assembling");
  });

  test("履歴から再印刷を選ぶと、バッジは印刷待ちに戻り、次のシートで先に印刷される", async () => {
    const a = paid();
    const b = paid();
    await run();
    reprintItems(db, { orderItemIds: [a.itemId], actor: "staff" });
    paid();
    await run();
    // a（再印刷）が、新しく待ち始めた c より先に載る
    const next = listPrintSlots(db.orm, lastSheet()?.id ?? "");
    expect(next[0]?.orderItemId).toBe(a.itemId);
    expect(b.itemId).toBeDefined();
  });
});

describe("ループの停止", () => {
  test("stop は、いま動いている巡回（印刷中）が終わるのを待ってから返り、そのあとは巡回しない", async () => {
    paid();
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let started = 0;
    let finished = 0;
    const slow: PrintDriver = {
      name: "slow",
      print: async () => {
        started += 1;
        await gate;
        finished += 1;
      },
    };
    const loop = startQueueLoop(db, { dataDir: dir, driver: slow, waitOverrideSeconds: 0 }, 10);
    while (started === 0) await new Promise((r) => setTimeout(r, 5));

    let stopped = false;
    const stopping = loop.stop().then(() => {
      stopped = true;
    });
    await new Promise((r) => setTimeout(r, 50));
    expect(stopped).toBe(false); // 印刷の送信が終わるまで、待っている
    release();
    await stopping;
    expect(finished).toBe(1);
    expect(stopped).toBe(true);

    paid();
    await new Promise((r) => setTimeout(r, 60));
    expect(started).toBe(1); // 停止後は、新しい巡回が始まらない
  });
});

describe("再印刷と、印刷待ちのバッジを、いっしょに印刷する", () => {
  /** 1 枚印刷して、reprintItemIds だけ、履歴から再印刷に回す */
  async function printAndCheck(reprintItemIds: string[]) {
    await run();
    reprintItems(db, { orderItemIds: reprintItemIds, actor: "staff" });
  }

  test("再印刷が出たとき、待ち時間（60 秒の半分）まで待って、そのあいだに来たバッジと、いっしょに印刷する", async () => {
    const a = paid();
    const b = paid();
    await printAndCheck([a.itemId]); // a は再印刷。b は OK
    const wait = { waitOverrideSeconds: 60 };
    const skips = createSkipRegistry();

    // 再印刷が、印刷待ちに戻った。1 個だけなので、すぐには、印刷しない
    expect((await run({ ...wait, skips })).status).toBe("waiting");

    // そのあいだに、新しい注文が、2 件入る
    const c = paid();
    const d = paid();
    clock.advance(20_000);
    expect((await run({ ...wait, skips })).status).toBe("waiting");

    // 再印刷が、30 秒待った（支払いから、ではなく、再印刷に戻ってから）。ここで、印刷する
    clock.advance(10_000);
    expect((await run({ ...wait, skips })).status).toBe("printed");
    const slots = listPrintSlots(db.orm, lastSheet()?.id ?? "");
    expect(slots.map((s) => s.orderItemId)).toEqual([a.itemId, c.itemId, d.itemId]);
    expect(b.itemId).toBeDefined();
  });

  test("再印刷だけのときも、半分の時間（30 秒）で、印刷する（お客さんを、長く待たせない）", async () => {
    const a = paid();
    await printAndCheck([a.itemId]);
    const options = {
      waitOverrideSeconds: 60,
      skips: createSkipRegistry(),
    };
    expect((await run(options)).status).toBe("waiting");
    clock.advance(29_000);
    expect((await run(options)).status).toBe("waiting");
    clock.advance(1_000);
    expect((await run(options)).status).toBe("printed");
  });

  test("支払いから時間がたっていても、再印刷の待ち時間は、再印刷に戻ったときから数える", async () => {
    const a = paid();
    // 支払いから、ふつうの待ち時間（60 秒）を、とっくにこえてから、印刷して、再印刷になる
    clock.advance(10 * 60 * 1000);
    await printAndCheck([a.itemId]);
    const options = {
      waitOverrideSeconds: 60,
      skips: createSkipRegistry(),
    };
    expect((await run(options)).status).toBe("waiting"); // すぐ印刷、には、ならない
  });

  test("用紙が埋まる数の、印刷待ちがあれば、再印刷を先頭にして、待たずに印刷する", async () => {
    const a = paid();
    await printAndCheck([a.itemId]);
    const others = [paid(), paid(), paid(), paid(), paid()];
    const result = await run({ waitOverrideSeconds: 9999 });
    expect(result.status).toBe("printed");
    const slots = listPrintSlots(db.orm, lastSheet()?.id ?? "");
    expect(slots.map((s) => s.orderItemId)).toEqual([a.itemId, ...others.map((o) => o.itemId)]);
  });
});
