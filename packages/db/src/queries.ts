import type { Design, Order, OrderItem, PrintSheet, PrintSlot, Setting } from "@canbadge/shared";
import { and, asc, eq } from "drizzle-orm";
import type { Reader } from "./connection";
import { notFound } from "./errors";
import { toDesign, toOrder, toOrderItem, toPrintSheet, toPrintSlot, toSetting } from "./rows";
import { designs, orderItems, orders, printSheets, printSlots, settings } from "./schema";

// 読み取りだけの関数。Orm でもトランザクションでも渡せる。
// 状態を変える操作は、ここではなく各遷移関数（orders.ts・items.ts・sheets.ts など）を通す。

export function getSetting(reader: Reader): Setting {
  const row = reader.select().from(settings).where(eq(settings.id, 1)).get();
  if (!row) throw new Error("設定の行がありません（マイグレーションと ensureSetting が必要です）");
  return toSetting(row);
}

export function getDesign(reader: Reader, id: string): Design | undefined {
  const row = reader.select().from(designs).where(eq(designs.id, id)).get();
  return row ? toDesign(row) : undefined;
}

export function getOrder(reader: Reader, id: string): Order | undefined {
  const row = reader.select().from(orders).where(eq(orders.id, id)).get();
  return row ? toOrder(row) : undefined;
}

export function requireOrder(reader: Reader, id: string): Order {
  const order = getOrder(reader, id);
  if (!order) throw notFound("注文");
  return order;
}

/** 営業日と注文番号から注文を探す（レジでの番号入力、注文照会） */
export function getOrderByNumber(
  reader: Reader,
  businessDate: string,
  orderNumber: number,
): Order | undefined {
  const row = reader
    .select()
    .from(orders)
    .where(and(eq(orders.businessDate, businessDate), eq(orders.orderNumber, orderNumber)))
    .get();
  return row ? toOrder(row) : undefined;
}

export function getOrderItem(reader: Reader, id: string): OrderItem | undefined {
  const row = reader.select().from(orderItems).where(eq(orderItems.id, id)).get();
  return row ? toOrderItem(row) : undefined;
}

export function requireOrderItem(reader: Reader, id: string): OrderItem {
  const item = getOrderItem(reader, id);
  if (!item) throw notFound("注文の明細");
  return item;
}

export function listOrderItems(reader: Reader, orderId: string): OrderItem[] {
  return reader
    .select()
    .from(orderItems)
    .where(eq(orderItems.orderId, orderId))
    .orderBy(asc(orderItems.id))
    .all()
    .map(toOrderItem);
}

export function getPrintSheet(reader: Reader, id: string): PrintSheet | undefined {
  const row = reader.select().from(printSheets).where(eq(printSheets.id, id)).get();
  return row ? toPrintSheet(row) : undefined;
}

export function requirePrintSheet(reader: Reader, id: string): PrintSheet {
  const sheet = getPrintSheet(reader, id);
  if (!sheet) throw notFound("印刷シート");
  return sheet;
}

/** シートに載っているバッジを、PDF 上の並び順で返す */
export function listPrintSlots(reader: Reader, sheetId: string): PrintSlot[] {
  return reader
    .select()
    .from(printSlots)
    .where(eq(printSlots.sheetId, sheetId))
    .orderBy(asc(printSlots.position))
    .all()
    .map(toPrintSlot);
}
