import { idSchema, type Order, type OrderStatus, type PrintSheet } from "@canbadge/shared";
import { and, count, desc, eq, inArray, lt, sql } from "drizzle-orm";
import type { Database } from "./connection";
import { getSetting } from "./queries";
import { toOrder, toPrintSheet } from "./rows";
import { designs, orderItems, orders, printSheets, printSlots } from "./schema";

// 画面向けの一覧と集計（読み取りだけ）。api が、ここの結果から画面向けの形を組み立てる。
// 一覧は新しい順で、続きは「前回の最後の行の目印（before）」より古いものを返す。

export type Page<T> = { items: T[]; nextBefore: string | null };

/** limit + 1 件読んで、続きがあるかを判断する。目印には、最後に返す行の目印を使う */
export function toPage<T>(rows: T[], limit: number, cursorOf: (row: T) => string): Page<T> {
  const items = rows.slice(0, limit);
  const last = items.at(-1);
  return { items, nextBefore: rows.length > limit && last ? cursorOf(last) : null };
}

/**
 * 注文を探す（スタッフのレジ・組み立て・受け渡し）。
 * - q が注文 ID（QR の中身）なら、その注文
 * - q が数字なら、現在の営業日のその注文番号
 * - q がなければ、現在の営業日の注文（営業開始の前は、すべて）
 */
export function searchOrders(
  db: Database,
  input: { q?: string; statuses?: OrderStatus[]; before?: string; limit: number },
): Page<Order> {
  const { businessDate } = getSetting(db.orm);
  const conditions = [];

  const q = input.q?.trim();
  if (q) {
    const asId = q.toUpperCase();
    if (idSchema.safeParse(asId).success) {
      conditions.push(eq(orders.id, asId));
    } else if (/^\d+$/.test(q)) {
      conditions.push(eq(orders.orderNumber, Number(q)));
      if (businessDate) conditions.push(eq(orders.businessDate, businessDate));
    } else {
      return { items: [], nextBefore: null };
    }
  } else if (businessDate) {
    conditions.push(eq(orders.businessDate, businessDate));
  }
  if (input.statuses && input.statuses.length > 0) {
    conditions.push(inArray(orders.status, input.statuses));
  }
  if (input.before) conditions.push(lt(orders.id, input.before));

  const rows = db.orm
    .select()
    .from(orders)
    .where(and(...conditions))
    .orderBy(desc(orders.id))
    .limit(input.limit + 1)
    .all()
    .map(toOrder);
  return toPage(rows, input.limit, (order) => order.id);
}

/** 呼び出し中（ready）の注文。完成した順 */
export function listReadyOrders(db: Database): Order[] {
  return db.orm
    .select()
    .from(orders)
    .where(eq(orders.status, "ready"))
    .orderBy(orders.readyAt, orders.id)
    .all()
    .map(toOrder);
}

/** 待ち件数。支払い済みで、まだ印刷が済んでいない注文の数 */
export function countWaitingOrders(db: Database): number {
  const row = db.orm.select({ n: count() }).from(orders).where(eq(orders.status, "paid")).get();
  return row?.n ?? 0;
}

/** 印刷中のシート（新しいほう）。なければ undefined */
export function getCurrentPrintSheet(db: Database): PrintSheet | undefined {
  const row = db.orm
    .select()
    .from(printSheets)
    .where(eq(printSheets.status, "printing"))
    .orderBy(desc(printSheets.id))
    .limit(1)
    .get();
  return row ? toPrintSheet(row) : undefined;
}

/** 印刷ジョブの履歴（新しい順） */
export function listPrintSheets(
  db: Database,
  input: { before?: string; limit: number },
): Page<PrintSheet> {
  const rows = db.orm
    .select()
    .from(printSheets)
    .where(input.before ? lt(printSheets.id, input.before) : undefined)
    .orderBy(desc(printSheets.id))
    .limit(input.limit + 1)
    .all()
    .map(toPrintSheet);
  return toPage(rows, input.limit, (sheet) => sheet.id);
}

/** シートに載っているバッジの詳細（注文番号・注文の状態・画像）。シートごと、位置の順 */
export type SlotDetail = {
  sheetId: string;
  position: number;
  orderItemId: string;
  result: "pending" | "ok" | "reprint";
  orderId: string;
  orderNumber: number;
  orderStatus: OrderStatus;
  imagePath: string;
};

export function listSlotDetails(db: Database, sheetIds: string[]): SlotDetail[] {
  if (sheetIds.length === 0) return [];
  return db.orm
    .select({
      sheetId: printSlots.sheetId,
      position: printSlots.position,
      orderItemId: printSlots.orderItemId,
      result: printSlots.result,
      orderId: orders.id,
      orderNumber: orders.orderNumber,
      orderStatus: orders.status,
      imagePath: designs.imagePath,
    })
    .from(printSlots)
    .innerJoin(orderItems, eq(orderItems.id, printSlots.orderItemId))
    .innerJoin(orders, eq(orders.id, orderItems.orderId))
    .innerJoin(designs, eq(designs.id, orderItems.designId))
    .where(inArray(printSlots.sheetId, sheetIds))
    .orderBy(printSlots.sheetId, printSlots.position)
    .all();
}

/** これまでに印刷したバッジ 1 個（最後に載ったシートの情報つき） */
export type PrintedItem = {
  orderItemId: string;
  orderId: string;
  orderNumber: number;
  orderStatus: OrderStatus;
  itemStatus: "queued" | "printing" | "printed";
  printCount: number;
  lastPrintedAt: string;
  imagePath: string;
};

type PrintedItemRow = {
  item_id: string;
  order_id: string;
  order_number: number;
  order_status: OrderStatus;
  item_status: PrintedItem["itemStatus"];
  print_count: number;
  last_printed_at: string;
  image_path: string;
  last_sheet_id: string;
};

/**
 * これまでに印刷したバッジの一覧。最後に印刷した（シートに載った）順に新しい順で、
 * 再印刷で印刷待ちに戻ったバッジも含める。q は注文番号（現在の営業日）
 */
export function listPrintedItems(
  db: Database,
  input: { q?: string; before?: string; limit: number },
): Page<PrintedItem> {
  const { businessDate } = getSetting(db.orm);
  const q = input.q?.trim();
  if (q && !/^\d+$/.test(q)) return { items: [], nextBefore: null };

  // 目印は「最後のシートの ID:バッジの ID」。この組が、目印より小さいものを返す
  const cursor = input.before?.split(":");
  const [cursorSheet, cursorItem] = cursor ?? [];

  const params: (string | number)[] = [];
  const where: string[] = [];
  if (q) {
    where.push("o.order_number = ?");
    params.push(Number(q));
    if (businessDate) {
      where.push("o.business_date = ?");
      params.push(businessDate);
    }
  }
  if (cursorSheet && cursorItem) {
    where.push("(ls.sheet_id, oi.id) < (?, ?)");
    params.push(cursorSheet, cursorItem);
  }

  const rows = db.sqlite
    .query(
      `SELECT oi.id AS item_id, oi.order_id, o.order_number, o.status AS order_status,
              oi.status AS item_status, oi.print_count, ps.printed_at AS last_printed_at,
              d.image_path, ls.sheet_id AS last_sheet_id
       FROM order_items oi
       JOIN orders o ON o.id = oi.order_id
       JOIN designs d ON d.id = oi.design_id
       JOIN (SELECT order_item_id, MAX(sheet_id) AS sheet_id
             FROM print_slots GROUP BY order_item_id) ls ON ls.order_item_id = oi.id
       JOIN print_sheets ps ON ps.id = ls.sheet_id
       ${where.length > 0 ? `WHERE ${where.join(" AND ")}` : ""}
       ORDER BY ls.sheet_id DESC, oi.id DESC
       LIMIT ?`,
    )
    .all(...params, input.limit + 1) as PrintedItemRow[];

  const page = toPage(rows, input.limit, (row) => `${row.last_sheet_id}:${row.item_id}`);
  return {
    items: page.items.map((row) => ({
      orderItemId: row.item_id,
      orderId: row.order_id,
      orderNumber: row.order_number,
      orderStatus: row.order_status,
      itemStatus: row.item_status,
      printCount: row.print_count,
      lastPrintedAt: row.last_printed_at,
      imagePath: row.image_path,
    })),
    nextBefore: page.nextBefore,
  };
}

export type SalesSummary = {
  businessDate: string;
  hourly: { hour: number; paidCount: number; paidAmount: number }[];
  total: {
    paidCount: number;
    paidAmount: number;
    refundedCount: number;
    refundedAmount: number;
    netAmount: number;
  };
};

/**
 * 営業日の売上。支払い済みになった注文（返金したものも含む）を、支払った時刻（日本時間）の
 * 時間帯ごとに数える。返金は全額のみなので、返金した注文の金額を、合計から差し引く
 */
export function salesSummary(db: Database, businessDate: string): SalesSummary {
  const hourly = db.sqlite
    .query(
      `SELECT CAST(strftime('%H', datetime(paid_at, '+9 hours')) AS INTEGER) AS hour,
              count(*) AS paid_count, COALESCE(sum(total_amount), 0) AS paid_amount
       FROM orders
       WHERE business_date = ? AND paid_at IS NOT NULL
       GROUP BY hour ORDER BY hour`,
    )
    .all(businessDate) as { hour: number; paid_count: number; paid_amount: number }[];

  const refunded = db.sqlite
    .query(
      `SELECT count(*) AS n, COALESCE(sum(total_amount), 0) AS amount
       FROM orders WHERE business_date = ? AND status = 'refunded'`,
    )
    .get(businessDate) as { n: number; amount: number };

  const paidCount = hourly.reduce((sum, row) => sum + row.paid_count, 0);
  const paidAmount = hourly.reduce((sum, row) => sum + row.paid_amount, 0);
  return {
    businessDate,
    hourly: hourly.map((row) => ({
      hour: row.hour,
      paidCount: row.paid_count,
      paidAmount: row.paid_amount,
    })),
    total: {
      paidCount,
      paidAmount,
      refundedCount: refunded.n,
      refundedAmount: refunded.amount,
      netAmount: paidAmount - refunded.amount,
    },
  };
}

/** 印刷できるバッジ 1 個（支払い済みの注文の、印刷待ちの明細） */
export type PrintableItem = {
  orderItemId: string;
  orderId: string;
  orderNumber: number;
  /** 印刷された回数。1 以上は再印刷で、優先して印刷する */
  printCount: number;
  /** 印刷待ちになった時刻（印刷待ちに戻った時刻。戻っていなければ、支払った時刻）。「最も古いバッジが一定時間待ったら印刷する」の判断に使う */
  waitingSince: string;
  /** 個数。用紙に、このバッジを何個並べるか（同じデザイン・同じ注文番号を、並べて印刷する） */
  quantity: number;
  /** quantity のうち、キラ加工の個数。用紙の注文番号の横に、その旨を印字する */
  kiraQuantity: number;
  /** quantity のうち、マグネット加工の個数。用紙の注文番号の横に、その旨を印字する */
  magnetQuantity: number;
  /** バッジのデザイン画像。データ置き場からの相対パス（例: images/<ID>.png）。印刷の PDF に載せる */
  imagePath: string;
};

/**
 * 印刷できるバッジを、印刷する順に返す（print-worker が使う）。再印刷のバッジを先に、
 * 次に古い順。注文が支払い済みでないもの（返金済み・取り消しなど）は含めない
 */
export function listPrintableItems(db: Database): PrintableItem[] {
  return db.orm
    .select({
      orderItemId: orderItems.id,
      orderId: orders.id,
      orderNumber: orders.orderNumber,
      printCount: orderItems.printCount,
      quantity: orderItems.quantity,
      kiraQuantity: orderItems.kiraQuantity,
      magnetQuantity: orderItems.magnetQuantity,
      // 印刷待ちに戻ったバッジ（再印刷など）は、その時刻から。ほかは、支払いの時刻から
      waitingSince: sql<string | null>`coalesce(${orderItems.requeuedAt}, ${orders.paidAt})`,
      imagePath: designs.imagePath,
    })
    .from(orderItems)
    .innerJoin(orders, eq(orders.id, orderItems.orderId))
    .innerJoin(designs, eq(designs.id, orderItems.designId))
    .where(and(eq(orderItems.status, "queued"), eq(orders.status, "paid")))
    .orderBy(desc(orderItems.printCount), orders.paidAt, orderItems.id)
    .all()
    .flatMap((row) => (row.waitingSince ? [{ ...row, waitingSince: row.waitingSince }] : []));
}
