import { describe, expect, test } from "bun:test";
import { DbError } from "./errors";
import {
  countWaitingOrders,
  getCurrentPrintSheet,
  listPrintableItems,
  listPrintedItems,
  listPrintSheets,
  listReadyOrders,
  listSlotDetails,
  salesSummary,
  searchOrders,
} from "./listings";
import { pickupOrder, transitionOrder } from "./orders";
import { checkPrintSheet, createPrintSheet } from "./sheets";
import { paidOrder, placeOrder, setup } from "./test-helpers";

function codeOf(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (error) {
    return error instanceof DbError ? error.code : `OTHER:${String(error)}`;
  }
  return undefined;
}

/** 支払い済み → 印刷 → 確認 → 組み立て → 完成まで進める */
function readyOrder(db: ReturnType<typeof setup>["db"]) {
  const { order, items } = paidOrder(db);
  const itemId = items[0]?.id ?? "";
  const { sheet } = createPrintSheet(db, { pdfPath: "sheets/s.pdf", orderItemIds: [itemId] });
  checkPrintSheet(db, { sheetId: sheet.id, reprintOrderItemIds: [], actor: "staff" });
  transitionOrder(db, { orderId: order.id, to: "assembling", actor: "staff" });
  const ready = transitionOrder(db, { orderId: order.id, to: "ready", actor: "staff" });
  return { order: ready, itemId, sheetId: sheet.id };
}

describe("受け渡しの確認コード", () => {
  test("確認コードが合えば、受け渡し済みになる", () => {
    const { db } = setup();
    const { order } = readyOrder(db);
    const picked = pickupOrder(db, {
      orderId: order.id,
      confirmationCode: order.confirmationCode,
      actor: "staff",
    });
    expect(picked.status).toBe("picked_up");
  });

  test("違えば CONFIRMATION_MISMATCH で、状態は変わらない", () => {
    const { db } = setup();
    const { order } = readyOrder(db);
    const wrong = order.confirmationCode === "2222" ? "3333" : "2222";
    expect(
      codeOf(() => pickupOrder(db, { orderId: order.id, confirmationCode: wrong, actor: "staff" })),
    ).toBe("CONFIRMATION_MISMATCH");
    const again = searchOrders(db, { q: order.id, limit: 10 }).items[0];
    expect(again?.status).toBe("ready");
  });

  test("コードが合っても、完成していない注文は受け渡せない", () => {
    const { db } = setup();
    const { order } = paidOrder(db);
    expect(
      codeOf(() =>
        pickupOrder(db, {
          orderId: order.id,
          confirmationCode: order.confirmationCode,
          actor: "staff",
        }),
      ),
    ).toBe("INVALID_TRANSITION");
  });
});

describe("注文の検索", () => {
  test("注文 ID（QR の中身）か、当日の注文番号で探せる。小文字の ID も受け付ける", () => {
    const { db } = setup();
    const a = placeOrder(db).order;
    const b = placeOrder(db).order;
    expect(searchOrders(db, { q: a.id, limit: 10 }).items.map((o) => o.id)).toEqual([a.id]);
    expect(searchOrders(db, { q: a.id.toLowerCase(), limit: 10 }).items.map((o) => o.id)).toEqual([
      a.id,
    ]);
    expect(
      searchOrders(db, { q: String(b.orderNumber), limit: 10 }).items.map((o) => o.id),
    ).toEqual([b.id]);
    expect(searchOrders(db, { q: "でたらめ", limit: 10 }).items).toEqual([]);
  });

  test("状態で絞れて、新しい順。続きは nextBefore で取る", () => {
    const { db } = setup();
    const ids = [placeOrder(db), placeOrder(db), placeOrder(db)].map((c) => c.order.id);
    const first = searchOrders(db, { statuses: ["submitted"], limit: 2 });
    expect(first.items.map((o) => o.id)).toEqual([ids[2] ?? "", ids[1] ?? ""]);
    expect(first.nextBefore).toBe(ids[1] ?? null);
    const second = searchOrders(db, {
      statuses: ["submitted"],
      limit: 2,
      before: first.nextBefore ?? "",
    });
    expect(second.items.map((o) => o.id)).toEqual([ids[0] ?? ""]);
    expect(second.nextBefore).toBeNull();
    expect(searchOrders(db, { statuses: ["ready"], limit: 10 }).items).toEqual([]);
  });

  test("前の営業日の注文は、番号の検索に出ない", () => {
    const { db } = setup();
    placeOrder(db);
    expect(searchOrders(db, { q: "99", limit: 10 }).items).toEqual([]);
  });
});

describe("呼び出しと待ち件数", () => {
  test("ready の注文が、完成した順に並ぶ", () => {
    const { db, clock } = setup();
    const first = readyOrder(db).order;
    clock.advance(60_000);
    const second = readyOrder(db).order;
    expect(listReadyOrders(db).map((o) => o.id)).toEqual([first.id, second.id]);
  });

  test("待ち件数は、支払い済みで印刷が済んでいない注文の数", () => {
    const { db } = setup();
    expect(countWaitingOrders(db)).toBe(0);
    placeOrder(db);
    paidOrder(db);
    paidOrder(db);
    expect(countWaitingOrders(db)).toBe(2);
  });
});

describe("印刷の履歴", () => {
  test("印刷中のシートと、履歴（新しい順）、シート上のバッジの詳細", () => {
    const { db } = setup();
    const a = paidOrder(db);
    const b = paidOrder(db);
    const first = createPrintSheet(db, {
      pdfPath: "sheets/1.pdf",
      orderItemIds: [a.items[0]?.id ?? ""],
    }).sheet;
    checkPrintSheet(db, { sheetId: first.id, reprintOrderItemIds: [], actor: "staff" });
    const second = createPrintSheet(db, {
      pdfPath: "sheets/2.pdf",
      orderItemIds: [b.items[0]?.id ?? ""],
    }).sheet;

    expect(getCurrentPrintSheet(db)?.id).toBe(second.id);
    const history = listPrintSheets(db, { limit: 1 });
    expect(history.items.map((s) => s.id)).toEqual([second.id]);
    expect(history.nextBefore).toBe(second.id);
    expect(listPrintSheets(db, { limit: 1, before: second.id }).items.map((s) => s.id)).toEqual([
      first.id,
    ]);

    const slots = listSlotDetails(db, [first.id, second.id]);
    expect(slots.map((s) => [s.sheetId, s.orderNumber, s.result])).toEqual([
      [first.id, a.order.orderNumber, "ok"],
      [second.id, b.order.orderNumber, "pending"],
    ]);
    expect(slots[0]?.imagePath).toBe("images/sample.png");
    expect(listSlotDetails(db, [])).toEqual([]);
  });

  test("印刷済みバッジの一覧：最後に印刷した順で、再印刷で戻ったバッジも含む。注文番号で探せる", () => {
    const { db } = setup();
    const a = paidOrder(db);
    const b = paidOrder(db);
    const itemA = a.items[0]?.id ?? "";
    const itemB = b.items[0]?.id ?? "";
    const s1 = createPrintSheet(db, {
      pdfPath: "sheets/1.pdf",
      orderItemIds: [itemA, itemB],
    }).sheet;
    checkPrintSheet(db, { sheetId: s1.id, reprintOrderItemIds: [itemB], actor: "staff" });
    const s2 = createPrintSheet(db, { pdfPath: "sheets/2.pdf", orderItemIds: [itemB] }).sheet;

    const all = listPrintedItems(db, { limit: 10 });
    expect(all.items.map((i) => [i.orderItemId, i.itemStatus, i.printCount])).toEqual([
      [itemB, "printing", 2],
      [itemA, "printed", 1],
    ]);
    expect(all.items[0]?.lastPrintedAt).toBe(s2.printedAt);
    expect(all.nextBefore).toBeNull();

    const pageOne = listPrintedItems(db, { limit: 1 });
    expect(pageOne.items).toHaveLength(1);
    const pageTwo = listPrintedItems(db, { limit: 1, before: pageOne.nextBefore ?? "" });
    expect(pageTwo.items.map((i) => i.orderItemId)).toEqual([itemA]);

    const found = listPrintedItems(db, { q: String(a.order.orderNumber), limit: 10 });
    expect(found.items.map((i) => i.orderItemId)).toEqual([itemA]);
    expect(listPrintedItems(db, { q: "abc", limit: 10 }).items).toEqual([]);
  });
});

describe("売上の集計", () => {
  test("支払い済みの注文を日本時間の時間帯ごとに数え、返金を差し引く", () => {
    const { db, clock } = setup("2026-11-03T09:10:00+09:00");
    paidOrder(db);
    clock.advance(60_000);
    paidOrder(db);
    clock.advance(60 * 60_000);
    const refunded = paidOrder(db).order;
    transitionOrder(db, { orderId: refunded.id, to: "refunded", actor: "staff" });
    placeOrder(db); // 支払い前は数えない

    const sales = salesSummary(db, "2026-11-03");
    expect(sales.hourly).toEqual([
      { hour: 9, paidCount: 2, paidAmount: 600 },
      { hour: 10, paidCount: 1, paidAmount: 300 },
    ]);
    expect(sales.total).toEqual({
      paidCount: 3,
      paidAmount: 900,
      refundedCount: 1,
      refundedAmount: 300,
      netAmount: 600,
    });
  });

  test("注文のない営業日は、すべて 0", () => {
    const { db } = setup();
    expect(salesSummary(db, "2020-01-01")).toEqual({
      businessDate: "2020-01-01",
      hourly: [],
      total: { paidCount: 0, paidAmount: 0, refundedCount: 0, refundedAmount: 0, netAmount: 0 },
    });
  });
});

describe("印刷できるバッジ", () => {
  test("支払い済みの注文の印刷待ちだけを、再印刷、古い順の並びで返す", () => {
    const { db, clock } = setup();
    placeOrder(db); // 支払い前は含めない
    const first = paidOrder(db);
    clock.advance(60_000);
    const second = paidOrder(db);
    clock.advance(60_000);
    const refunded = paidOrder(db);
    transitionOrder(db, { orderId: refunded.order.id, to: "refunded", actor: "staff" });

    const ids = (items: { orderItemId: string }[]) => items.map((i) => i.orderItemId);
    const firstItem = first.items[0]?.id ?? "";
    const secondItem = second.items[0]?.id ?? "";
    expect(ids(listPrintableItems(db))).toEqual([firstItem, secondItem]);

    // 2 番目のバッジを印刷して再印刷に回すと、printCount が 1 になり、先頭に来る
    const { sheet } = createPrintSheet(db, { pdfPath: "sheets/1.pdf", orderItemIds: [secondItem] });
    checkPrintSheet(db, { sheetId: sheet.id, reprintOrderItemIds: [secondItem], actor: "staff" });
    expect(ids(listPrintableItems(db))).toEqual([secondItem, firstItem]);
    expect(listPrintableItems(db)[0]).toMatchObject({
      printCount: 1,
      orderNumber: second.order.orderNumber,
    });
  });
});
