// この端末で開いた注文の ID を、ブラウザ（localStorage）に覚えておく。「自分の注文を確認する」で、
// 注文番号と確認コードを入れなくても、一覧から開けるようにするため。
// 中身（状態など）は覚えず、開くたびに api から取り直す。注文 ID は推測できない長い ID で、それ自体が
// 開くための鍵（仕様 5 章）。覚えるのはこの端末で開いた注文だけなので、他人の注文が並ぶことはない。
// localStorage が使えなくても（プライベートモードなど）、画面は動く（一覧が出ないだけ）。

import { localStore } from "./browser-storage";

const KEY = "canbadge-my-orders";
/** 覚えておく件数。新しいものから。学祭の数日分で足りるので、多く持たない */
export const MAX_REMEMBERED_ORDERS = 20;

type ReadStorage = Pick<Storage, "getItem">;
type WriteStorage = Pick<Storage, "getItem" | "setItem">;

/** 覚えている注文 ID。新しい順。読めなければ空 */
export function rememberedOrders(storage: ReadStorage = localStore()): string[] {
  try {
    const raw = storage.getItem(KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed)
      ? parsed.filter((id): id is string => typeof id === "string" && id !== "")
      : [];
  } catch {
    return [];
  }
}

/** 注文を覚える（いちばん新しいものとして、先頭に置く。同じ注文は 1 つにまとめる） */
export function rememberOrder(orderId: string, storage: WriteStorage = localStore()) {
  const next = [orderId, ...rememberedOrders(storage).filter((id) => id !== orderId)].slice(
    0,
    MAX_REMEMBERED_ORDERS,
  );
  try {
    storage.setItem(KEY, JSON.stringify(next));
  } catch {
    // 覚えられなくても、注文は困らない
  }
}

/** もう出さない注文（見つからない・止まった注文）を、忘れる */
export function forgetOrders(orderIds: readonly string[], storage: WriteStorage = localStore()) {
  if (orderIds.length === 0) return;
  const next = rememberedOrders(storage).filter((id) => !orderIds.includes(id));
  try {
    storage.setItem(KEY, JSON.stringify(next));
  } catch {
    // 消せなくても、困らない（次に開いたとき、また外す）
  }
}
