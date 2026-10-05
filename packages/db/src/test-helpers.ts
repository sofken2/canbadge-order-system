import { createManualClock } from "./clock";
import { type Database, openDatabase } from "./connection";
import { createOrder, transitionOrder } from "./orders";
import { openBusinessDay } from "./settings";

export const TOKEN = "a".repeat(32);

/** メモリ上の DB を開き、営業を開始した状態にする。時刻は手で進められる */
export function setup(startIso = "2026-11-03T09:00:00+09:00") {
  const clock = createManualClock(startIso);
  const db = openDatabase({ path: ":memory:", now: clock.now });
  openBusinessDay(db, { actor: "staff" });
  return { db, clock };
}

/** 営業開始前の、受付終了の状態の DB */
export function setupClosed(startIso = "2026-11-03T09:00:00+09:00") {
  const clock = createManualClock(startIso);
  const db = openDatabase({ path: ":memory:", now: clock.now });
  return { db, clock };
}

export function placeOrder(db: Database, quantity = 1) {
  return createOrder(db, {
    imagePath: "images/sample.png",
    editorData: { version: 1 },
    quantity,
    anonToken: TOKEN,
  });
}

export function payOrder(db: Database, orderId: string) {
  return transitionOrder(db, { orderId, to: "paid", actor: "staff" });
}

/** 注文して、支払い済みにする */
export function paidOrder(db: Database, quantity = 1) {
  const created = placeOrder(db, quantity);
  const order = payOrder(db, created.order.id);
  return { ...created, order };
}
