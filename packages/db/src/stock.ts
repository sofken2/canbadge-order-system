import type { Setting } from "@canbadge/shared";
import { notInArray, sql } from "drizzle-orm";
import type { Reader } from "./connection";
import { orderItems, orders } from "./schema";

/** 在庫の残り。総数（設定）から、使われている数を引いた数 */
export type StockRemaining = {
  badge: number;
  kiraFilm: number;
  magnet: number;
};

/**
 * 在庫の残りを数える。使われているのは、失効・取り消し以外の注文（支払い前も、取り置きとして数える）。
 * 返金済みは、すでに作ったものとして、数えたままにする（戻すなら、設定で総数を直す）。
 * 残りを列に持たず、そのつど数えるので、注文と総数の変更が重なっても、ずれない
 */
export function getStockRemaining(reader: Reader, setting: Setting): StockRemaining {
  const used = reader
    .select({
      badge: sql<number>`coalesce(sum(${orderItems.quantity}), 0)`,
      kira: sql<number>`coalesce(sum(${orderItems.kiraQuantity}), 0)`,
      magnet: sql<number>`coalesce(sum(${orderItems.magnetQuantity}), 0)`,
    })
    .from(orderItems)
    .innerJoin(orders, sql`${orders.id} = ${orderItems.orderId}`)
    .where(notInArray(orders.status, ["expired", "cancelled"]))
    .get();
  return {
    badge: Math.max(0, setting.badgeStock - (used?.badge ?? 0)),
    kiraFilm: Math.max(0, setting.kiraFilmStock - (used?.kira ?? 0)),
    magnet: Math.max(0, setting.magnetStock - (used?.magnet ?? 0)),
  };
}
