import type { ArchiveConsent, EditorData } from "@canbadge/shared";
import {
  acceptanceSchema,
  actorSchema,
  archiveStatusSchema,
  auditTargetTypeSchema,
  orderItemStatusSchema,
  orderStatusSchema,
  printSheetStatusSchema,
  printSlotResultSchema,
  reportStatusSchema,
} from "@canbadge/shared";
import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

/** zod の列挙の候補を、Drizzle の enum が求める「1 つ以上の配列」の型にする */
function values<T extends string>(options: readonly T[]): [T, ...T[]] {
  const [first, ...rest] = options;
  if (first === undefined) throw new Error("列挙の候補が空です");
  return [first, ...rest];
}

// 型の正本は packages/shared の zod スキーマ。ここのテーブル定義は、それに合わせて書く。
// 状態の列の取りうる値は shared の列挙から取り、食い違いは rows.test.ts の型のテストで検出する。
// 日時は ISO 8601 の文字列で持つ。null は「ない」ことを表し、読み出すときに undefined にそろえる（rows.ts）。

export const designs = sqliteTable("designs", {
  id: text("id").primaryKey(),
  /** データ置き場の images/ 以下の相対パス。画像そのものは DB に入れない */
  imagePath: text("image_path").notNull(),
  editorData: text("editor_data", { mode: "json" }).$type<EditorData>().notNull(),
  // アーカイブ作品との相互参照になるので、外部キーは張らない
  sourceArchiveEntryId: text("source_archive_entry_id"),
  createdAt: text("created_at").notNull(),
});

export const orders = sqliteTable(
  "orders",
  {
    id: text("id").primaryKey(),
    businessDate: text("business_date").notNull(),
    orderNumber: integer("order_number").notNull(),
    confirmationCode: text("confirmation_code").notNull(),
    anonToken: text("anon_token").notNull(),
    status: text("status", { enum: values(orderStatusSchema.options) }).notNull(),
    totalAmount: integer("total_amount").notNull(),
    createdAt: text("created_at").notNull(),
    paidAt: text("paid_at"),
    readyAt: text("ready_at"),
    pickedUpAt: text("picked_up_at"),
    refundedAt: text("refunded_at"),
  },
  (t) => [
    // 注文番号は営業日の中で一意。採番の競合を、最後の砦として DB でも防ぐ
    uniqueIndex("orders_business_date_number").on(t.businessDate, t.orderNumber),
    index("orders_status").on(t.status),
    index("orders_anon_token").on(t.anonToken),
  ],
);

export const orderItems = sqliteTable(
  "order_items",
  {
    id: text("id").primaryKey(),
    orderId: text("order_id")
      .notNull()
      .references(() => orders.id),
    designId: text("design_id")
      .notNull()
      .references(() => designs.id),
    quantity: integer("quantity").notNull(),
    status: text("status", { enum: values(orderItemStatusSchema.options) }).notNull(),
    printCount: integer("print_count").notNull().default(0),
  },
  (t) => [index("order_items_order_id").on(t.orderId), index("order_items_status").on(t.status)],
);

export const printSheets = sqliteTable("print_sheets", {
  id: text("id").primaryKey(),
  /** データ置き場の sheets/ 以下の相対パス */
  pdfPath: text("pdf_path").notNull(),
  status: text("status", { enum: values(printSheetStatusSchema.options) }).notNull(),
  printedAt: text("printed_at").notNull(),
  checkedAt: text("checked_at"),
});

/** シート上のバッジ 1 個 = 1 行。印刷の履歴として、削除しない */
export const printSlots = sqliteTable(
  "print_slots",
  {
    sheetId: text("sheet_id")
      .notNull()
      .references(() => printSheets.id),
    position: integer("position").notNull(),
    orderItemId: text("order_item_id")
      .notNull()
      .references(() => orderItems.id),
    result: text("result", { enum: values(printSlotResultSchema.options) }).notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.sheetId, t.position] }),
    index("print_slots_order_item_id").on(t.orderItemId),
  ],
);

/** 設定。1 行だけ（id = 1 固定） */
export const settings = sqliteTable(
  "settings",
  {
    id: integer("id").primaryKey(),
    businessDate: text("business_date"),
    acceptance: text("acceptance", { enum: values(acceptanceSchema.options) }).notNull(),
    busyMessage: text("busy_message"),
    price: integer("price").notNull(),
    maxQuantityPerOrder: integer("max_quantity_per_order").notNull(),
    maxPendingPerDevice: integer("max_pending_per_device").notNull(),
    printMaxWaitSeconds: integer("print_max_wait_seconds").notNull(),
    printPaused: integer("print_paused", { mode: "boolean" }).notNull(),
    orderNumberDigits: integer("order_number_digits").notNull(),
    imageMaxBytes: integer("image_max_bytes").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [check("settings_singleton", sql`${t.id} = 1`)],
);

/**
 * 操作ログ。seq は DB 内部の通し番号で、api が「前回確認した以降の行」を読むのに使う
 * （print-worker の変更を拾って SSE を流すため）。契約の AuditLog には含めない
 */
export const auditLogs = sqliteTable("audit_logs", {
  seq: integer("seq").primaryKey({ autoIncrement: true }),
  id: text("id").notNull().unique(),
  actor: text("actor", { enum: values(actorSchema.options) }).notNull(),
  at: text("at").notNull(),
  action: text("action").notNull(),
  targetType: text("target_type", { enum: values(auditTargetTypeSchema.options) }).notNull(),
  targetId: text("target_id").notNull(),
  detail: text("detail", { mode: "json" }).$type<Record<string, unknown>>(),
});

export const archiveEntries = sqliteTable(
  "archive_entries",
  {
    id: text("id").primaryKey(),
    designId: text("design_id")
      .notNull()
      .references(() => designs.id),
    displayName: text("display_name").notNull(),
    status: text("status", { enum: values(archiveStatusSchema.options) }).notNull(),
    consent: text("consent", { mode: "json" }).$type<ArchiveConsent>().notNull(),
    authorAnonToken: text("author_anon_token").notNull(),
    createdAt: text("created_at").notNull(),
    reviewedAt: text("reviewed_at"),
  },
  (t) => [index("archive_entries_status").on(t.status)],
);

export const reports = sqliteTable("reports", {
  id: text("id").primaryKey(),
  archiveEntryId: text("archive_entry_id")
    .notNull()
    .references(() => archiveEntries.id),
  reason: text("reason").notNull(),
  status: text("status", { enum: values(reportStatusSchema.options) }).notNull(),
  createdAt: text("created_at").notNull(),
  resolvedAt: text("resolved_at"),
});
