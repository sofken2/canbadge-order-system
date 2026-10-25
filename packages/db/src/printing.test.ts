import { describe, expect, test } from "bun:test";
import { listAuditLogsSince } from "./audit";
import { DbError } from "./errors";
import { transitionOrderItem } from "./items";
import { transitionOrder } from "./orders";
import { getOrder, getOrderItem, getPrintSheet, listOrderItems, listPrintSlots } from "./queries";
import { reprintItems } from "./reprint";
import {
  completePrintSheet,
  createPrintSheet,
  failPrintSheet,
  transitionPrintSheet,
} from "./sheets";
import { paidOrder, placeOrder, setup } from "./test-helpers";

function codeOf(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (error) {
    return error instanceof DbError ? error.code : `OTHER:${String(error)}`;
  }
  return undefined;
}

/** 支払い済みの注文を 1 件作り、その明細の ID も返す */
function readyToPrint(db: ReturnType<typeof setup>["db"]) {
  const { order, items } = paidOrder(db);
  const item = items[0];
  if (!item) throw new Error("明細がありません");
  return { orderId: order.id, itemId: item.id };
}

describe("印刷シートの作成", () => {
  test("バッジが印刷中になり、並び順がシート上の位置になる。印刷回数が 1 増える", () => {
    const { db } = setup();
    const a = readyToPrint(db);
    const b = readyToPrint(db);
    const { sheet, slots } = createPrintSheet(db, {
      pdfPath: "sheets/s1.pdf",
      orderItemIds: [b.itemId, a.itemId],
    });

    expect(sheet.status).toBe("printing");
    expect(slots.map((s) => [s.position, s.orderItemId, s.result])).toEqual([
      [0, b.itemId, "pending"],
      [1, a.itemId, "pending"],
    ]);
    for (const id of [a.itemId, b.itemId]) {
      expect(getOrderItem(db.orm, id)).toMatchObject({ status: "printing", printCount: 1 });
    }
  });

  test("個数（copies）があるバッジは、その数だけ用紙の位置を使う。位置は、最初の 1 個の位置", () => {
    const { db } = setup();
    const a = readyToPrint(db);
    const b = readyToPrint(db);
    const c = readyToPrint(db);
    const { slots } = createPrintSheet(db, {
      pdfPath: "sheets/s-copies.pdf",
      orderItemIds: [a.itemId, b.itemId, c.itemId],
      copies: [2, 1, 3],
    });
    // 用紙の 1・2 番目が a、3 番目が b、4〜6 番目が c
    expect(slots.map((s) => [s.position, s.orderItemId])).toEqual([
      [0, a.itemId],
      [2, b.itemId],
      [3, c.itemId],
    ]);
  });

  test("個数が、バッジの数と合わない・0・小数なら、断る（シートは残らない）", () => {
    const { db } = setup();
    const a = readyToPrint(db);
    const b = readyToPrint(db);
    for (const copies of [[1], [1, 0], [1, 1.5], [1, -1]]) {
      expect(
        codeOf(() =>
          createPrintSheet(db, {
            pdfPath: "sheets/x.pdf",
            orderItemIds: [a.itemId, b.itemId],
            copies,
          }),
        ),
      ).toBe("VALIDATION_FAILED");
    }
    expect(getOrderItem(db.orm, a.itemId)?.status).toBe("queued");
  });

  test("印刷中のシートがあるうちは、次のシートを作れない（いまのシートが終わるまで、次を送らない）", () => {
    const { db } = setup();
    const a = readyToPrint(db);
    const b = readyToPrint(db);
    const first = createPrintSheet(db, { pdfPath: "sheets/1.pdf", orderItemIds: [a.itemId] });
    expect(
      codeOf(() => createPrintSheet(db, { pdfPath: "sheets/2.pdf", orderItemIds: [b.itemId] })),
    ).toBe("CONFLICT");
    // 断られたバッジは、そのまま印刷待ち
    expect(getOrderItem(db.orm, b.itemId)?.status).toBe("queued");

    // 印刷が終われば、次を作れる
    completePrintSheet(db, { sheetId: first.sheet.id });
    expect(() =>
      createPrintSheet(db, { pdfPath: "sheets/2.pdf", orderItemIds: [b.itemId] }),
    ).not.toThrow();
  });

  test("支払い前の注文のバッジは載せられず、シートも残らない", () => {
    const { db } = setup();
    const paid = readyToPrint(db);
    const unpaid = placeOrder(db).items[0];
    const before = db.sqlite.query("SELECT count(*) AS n FROM print_sheets").get();

    const attempt = () =>
      createPrintSheet(db, {
        pdfPath: "sheets/s1.pdf",
        orderItemIds: [paid.itemId, unpaid?.id ?? ""],
      });
    expect(codeOf(attempt)).toBe("INVALID_TRANSITION");

    expect(db.sqlite.query("SELECT count(*) AS n FROM print_sheets").get()).toEqual(before);
    expect(getOrderItem(db.orm, paid.itemId)?.status).toBe("queued");
  });

  test("返金済みの注文に残った印刷待ちのバッジは、載せられない", () => {
    const { db } = setup();
    const { orderId, itemId } = readyToPrint(db);
    transitionOrder(db, { orderId, to: "refunded", actor: "staff" });
    expect(
      codeOf(() => createPrintSheet(db, { pdfPath: "sheets/s.pdf", orderItemIds: [itemId] })),
    ).toBe("INVALID_TRANSITION");
  });

  test("空・重複・不正なパスは断る", () => {
    const { db } = setup();
    const { itemId } = readyToPrint(db);
    expect(codeOf(() => createPrintSheet(db, { pdfPath: "sheets/s.pdf", orderItemIds: [] }))).toBe(
      "VALIDATION_FAILED",
    );
    expect(
      codeOf(() =>
        createPrintSheet(db, { pdfPath: "sheets/s.pdf", orderItemIds: [itemId, itemId] }),
      ),
    ).toBe("VALIDATION_FAILED");
    expect(
      codeOf(() => createPrintSheet(db, { pdfPath: "../s.pdf", orderItemIds: [itemId] })),
    ).toBe("VALIDATION_FAILED");
  });
});

describe("印刷の完了と失敗", () => {
  test("完了すると、バッジは印刷済み、注文は自動で組み立て中になり、シートは確認済みになる", () => {
    const { db, clock } = setup();
    const a = readyToPrint(db);
    const b = readyToPrint(db);
    const { sheet } = createPrintSheet(db, {
      pdfPath: "sheets/s1.pdf",
      orderItemIds: [a.itemId, b.itemId],
    });

    clock.advance(30_000);
    const done = completePrintSheet(db, { sheetId: sheet.id });
    expect(done.sheet).toMatchObject({
      status: "confirmed",
      checkedAt: "2026-11-03T00:00:30.000Z",
    });
    expect(done.slots.map((s) => s.result)).toEqual(["ok", "ok"]);
    for (const { orderId, itemId } of [a, b]) {
      expect(getOrderItem(db.orm, itemId)?.status).toBe("printed");
      expect(getOrder(db.orm, orderId)?.status).toBe("assembling");
    }
    // 自動の遷移は system の操作として記録される
    const autoLogs = listAuditLogsSince(db, 0).filter(
      (e) =>
        e.log.action === "order.transition" &&
        e.log.actor === "system" &&
        e.log.detail?.to === "assembling",
    );
    expect(autoLogs).toHaveLength(2);
  });

  test("注文の全バッジが印刷済みになるまで、注文は印刷待ちのまま（複数の明細の注文）", () => {
    const { db } = setup();
    const a = readyToPrint(db);
    const { sheet } = createPrintSheet(db, { pdfPath: "sheets/s1.pdf", orderItemIds: [a.itemId] });
    // 同じ注文に、まだ印刷していない明細があれば、注文は進まない
    db.sqlite
      .query(
        "INSERT INTO order_items (id, order_id, design_id, quantity, kira_quantity, magnet_quantity, status, print_count) SELECT '01HZX3V5Q8N4M6T2B9C7D1E0FB', order_id, design_id, 1, 0, 0, 'queued', 0 FROM order_items WHERE id = ?",
      )
      .run(a.itemId);
    completePrintSheet(db, { sheetId: sheet.id });
    expect(getOrder(db.orm, a.orderId)?.status).toBe("paid");
  });

  test("失敗すると、バッジは印刷待ちに戻り（印刷回数は残る）、シートは失敗になる。次のシートで印刷できる", () => {
    const { db } = setup();
    const a = readyToPrint(db);
    const b = readyToPrint(db);
    const first = createPrintSheet(db, {
      pdfPath: "sheets/s1.pdf",
      orderItemIds: [a.itemId, b.itemId],
    });
    const failed = failPrintSheet(db, { sheetId: first.sheet.id });
    expect(failed.sheet.status).toBe("failed");
    expect(failed.slots.map((s) => s.result)).toEqual(["reprint", "reprint"]);
    expect(getOrderItem(db.orm, a.itemId)).toMatchObject({ status: "queued", printCount: 1 });
    expect(getOrder(db.orm, a.orderId)?.status).toBe("paid");

    // 印刷中のシートはなくなったので、次のシートを作れる。履歴（最初のシート）は残る
    const second = createPrintSheet(db, {
      pdfPath: "sheets/s2.pdf",
      orderItemIds: [a.itemId, b.itemId],
    });
    expect(getOrderItem(db.orm, a.itemId)?.printCount).toBe(2);
    completePrintSheet(db, { sheetId: second.sheet.id });
    expect(getOrder(db.orm, a.orderId)?.status).toBe("assembling");
    expect(listPrintSlots(db.orm, first.sheet.id)).toHaveLength(2);
  });

  test("完了・失敗済みのシートは、もう一度は完了も失敗もできない", () => {
    const { db } = setup();
    const a = readyToPrint(db);
    const { sheet } = createPrintSheet(db, { pdfPath: "sheets/s1.pdf", orderItemIds: [a.itemId] });
    completePrintSheet(db, { sheetId: sheet.id });
    expect(codeOf(() => completePrintSheet(db, { sheetId: sheet.id }))).toBe("INVALID_TRANSITION");
    expect(codeOf(() => failPrintSheet(db, { sheetId: sheet.id }))).toBe("INVALID_TRANSITION");
  });

  test("シートの状態は、system だけが変えられる（スタッフ・来場者は、できない）", () => {
    const { db } = setup();
    const a = readyToPrint(db);
    const { sheet } = createPrintSheet(db, { pdfPath: "sheets/s1.pdf", orderItemIds: [a.itemId] });
    for (const actor of ["visitor", "staff"] as const) {
      expect(
        codeOf(() => transitionPrintSheet(db, { sheetId: sheet.id, to: "failed", actor })),
      ).toBe("INVALID_TRANSITION");
    }
    expect(
      transitionPrintSheet(db, { sheetId: sheet.id, to: "failed", actor: "system" }).status,
    ).toBe("failed");
  });

  test("明細の遷移も、表にないものは断る（印刷待ちから印刷済みへ。スタッフが印刷済みにすることも）", () => {
    const { db } = setup();
    const a = readyToPrint(db);
    expect(
      codeOf(() => transitionOrderItem(db, { itemId: a.itemId, to: "printed", actor: "system" })),
    ).toBe("INVALID_TRANSITION");
    createPrintSheet(db, { pdfPath: "sheets/s1.pdf", orderItemIds: [a.itemId] });
    expect(
      codeOf(() => transitionOrderItem(db, { itemId: a.itemId, to: "printed", actor: "staff" })),
    ).toBe("INVALID_TRANSITION");
  });
});

/** 支払い済み → 印刷（完了で、自動で組み立て中）→ 完成まで進める */
function readyOrder(db: ReturnType<typeof setup>["db"]) {
  const target = readyToPrint(db);
  const { sheet } = createPrintSheet(db, {
    pdfPath: "sheets/s.pdf",
    orderItemIds: [target.itemId],
  });
  completePrintSheet(db, { sheetId: sheet.id });
  transitionOrder(db, { orderId: target.orderId, to: "ready", actor: "staff" });
  return target;
}

describe("履歴からの再印刷", () => {
  test("完成した注文のバッジを再印刷すると、注文は印刷待ちに戻り、完成の時刻が消える", () => {
    const { db } = setup();
    const { orderId, itemId } = readyOrder(db);
    expect(getOrder(db.orm, orderId)?.readyAt).toBeDefined();

    const result = reprintItems(db, { orderItemIds: [itemId], actor: "staff" });
    expect(result).toEqual({ reprintedItemIds: [itemId], skippedItemIds: [] });
    expect(getOrderItem(db.orm, itemId)?.status).toBe("queued");
    const order = getOrder(db.orm, orderId);
    expect(order?.status).toBe("paid");
    expect(order?.readyAt).toBeUndefined();

    // 次のシートで印刷が終わると、注文は組み立て中に戻る
    const { sheet } = createPrintSheet(db, { pdfPath: "sheets/again.pdf", orderItemIds: [itemId] });
    completePrintSheet(db, { sheetId: sheet.id });
    expect(getOrder(db.orm, orderId)?.status).toBe("assembling");
    expect(getOrderItem(db.orm, itemId)?.printCount).toBe(2);
  });

  test("組み立て中の注文からも、印刷待ちに戻せる", () => {
    const { db } = setup();
    const a = readyToPrint(db);
    const sheet = createPrintSheet(db, { pdfPath: "sheets/s.pdf", orderItemIds: [a.itemId] });
    completePrintSheet(db, { sheetId: sheet.sheet.id });
    expect(getOrder(db.orm, a.orderId)?.status).toBe("assembling");
    reprintItems(db, { orderItemIds: [a.itemId], actor: "staff" });
    expect(getOrder(db.orm, a.orderId)?.status).toBe("paid");

    const b = readyToPrint(db);
    const sheetB = createPrintSheet(db, { pdfPath: "sheets/b.pdf", orderItemIds: [b.itemId] });
    completePrintSheet(db, { sheetId: sheetB.sheet.id });
    reprintItems(db, { orderItemIds: [b.itemId], actor: "staff" });
    expect(getOrder(db.orm, b.orderId)?.status).toBe("paid");
  });

  test("すでに印刷待ちのバッジは、何もせず skipped に入れる", () => {
    const { db } = setup();
    const { itemId } = readyToPrint(db);
    expect(reprintItems(db, { orderItemIds: [itemId], actor: "staff" })).toEqual({
      reprintedItemIds: [],
      skippedItemIds: [itemId],
    });
  });

  test("印刷中のバッジは、履歴からは断る（印刷が終わってから）", () => {
    const { db } = setup();
    const { itemId } = readyToPrint(db);
    createPrintSheet(db, { pdfPath: "sheets/s.pdf", orderItemIds: [itemId] });
    expect(codeOf(() => reprintItems(db, { orderItemIds: [itemId], actor: "staff" }))).toBe(
      "INVALID_TRANSITION",
    );
  });

  test("受け渡し済み・返金済みの注文のバッジは断る", () => {
    const { db } = setup();
    const delivered = readyOrder(db);
    transitionOrder(db, { orderId: delivered.orderId, to: "picked_up", actor: "staff" });
    expect(
      codeOf(() => reprintItems(db, { orderItemIds: [delivered.itemId], actor: "staff" })),
    ).toBe("INVALID_TRANSITION");

    const refunded = readyOrder(db);
    transitionOrder(db, { orderId: refunded.orderId, to: "refunded", actor: "staff" });
    expect(
      codeOf(() => reprintItems(db, { orderItemIds: [refunded.itemId], actor: "staff" })),
    ).toBe("INVALID_TRANSITION");
  });

  test("1 つでも再印刷できなければ、全体を取り消す（一部だけ実行しない）", () => {
    const { db } = setup();
    const ok = readyOrder(db);
    const delivered = readyOrder(db);
    transitionOrder(db, { orderId: delivered.orderId, to: "picked_up", actor: "staff" });
    const before = listAuditLogsSince(db, 0).length;

    expect(
      codeOf(() =>
        reprintItems(db, { orderItemIds: [ok.itemId, delivered.itemId], actor: "staff" }),
      ),
    ).toBe("INVALID_TRANSITION");

    expect(getOrderItem(db.orm, ok.itemId)?.status).toBe("printed");
    expect(getOrder(db.orm, ok.orderId)?.status).toBe("ready");
    expect(listAuditLogsSince(db, 0)).toHaveLength(before);
  });

  test("存在しないバッジ・空の指定は断る", () => {
    const { db } = setup();
    expect(
      codeOf(() =>
        reprintItems(db, { orderItemIds: ["01HZX3V5Q8N4M6T2B9C7D1E0FA"], actor: "staff" }),
      ),
    ).toBe("NOT_FOUND");
    expect(codeOf(() => reprintItems(db, { orderItemIds: [], actor: "staff" }))).toBe(
      "VALIDATION_FAILED",
    );
  });

  test("再印刷前の状態が、操作ログに残る", () => {
    const { db } = setup();
    const { orderId, itemId } = readyOrder(db);
    reprintItems(db, { orderItemIds: [itemId], actor: "staff" });
    const log = listAuditLogsSince(db, 0)
      .map((e) => e.log)
      .find((l) => l.action === "reprint");
    expect(log).toMatchObject({
      actor: "staff",
      targetType: "order_item",
      targetId: itemId,
      detail: { orderId, previousOrderStatus: "ready" },
    });
  });
});
