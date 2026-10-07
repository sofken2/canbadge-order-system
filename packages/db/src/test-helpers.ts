import { createManualClock } from "./clock";
import { type Database, openDatabase } from "./connection";
import { createOrder, transitionOrder } from "./orders";
import { openBusinessDay } from "./settings";

export const TOKEN = "a".repeat(32);

let tokenCounter = 0;
/** 呼ぶたびに違う匿名トークン（32 文字）。1 端末あたりの支払い待ちの上限（A06）に当たらないよう、注文ごとに別の端末として扱う */
export function uniqueToken(): string {
  tokenCounter += 1;
  return `${"u".repeat(24)}${String(tokenCounter).padStart(8, "0")}`;
}

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

/** 注文する。token を省くと、注文ごとに別の端末（匿名トークン）になる */
export function placeOrder(db: Database, quantity = 1, token: string = uniqueToken()) {
  return createOrder(db, {
    imagePath: "images/sample.png",
    editorData: { version: 1 },
    quantity,
    anonToken: token,
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
