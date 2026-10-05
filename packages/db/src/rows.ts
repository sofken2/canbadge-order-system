import {
  type ArchiveEntry,
  type AuditLog,
  archiveEntrySchema,
  auditLogSchema,
  type Design,
  designSchema,
  type Order,
  type OrderItem,
  orderItemSchema,
  orderSchema,
  type PrintSheet,
  type PrintSlot,
  printSheetSchema,
  printSlotSchema,
  type Report,
  reportSchema,
  type Setting,
  settingSchema,
} from "@canbadge/shared";
import type {
  archiveEntries,
  auditLogs,
  designs,
  orderItems,
  orders,
  printSheets,
  printSlots,
  reports,
  settings,
} from "./schema";

// DB の行を、契約（packages/shared）のエンティティにする。
// SQLite の null の列は、キーごと取り除き（契約では「省略」で表す）、zod で検証して返す。
// DB と契約のずれは、型のテスト（rows.test.ts）と、ここでの実行時の検証で見つかる。

export type DesignRow = typeof designs.$inferSelect;
export type OrderRow = typeof orders.$inferSelect;
export type OrderItemRow = typeof orderItems.$inferSelect;
export type PrintSheetRow = typeof printSheets.$inferSelect;
export type PrintSlotRow = typeof printSlots.$inferSelect;
export type SettingRow = typeof settings.$inferSelect;
export type AuditLogRow = typeof auditLogs.$inferSelect;
export type ArchiveEntryRow = typeof archiveEntries.$inferSelect;
export type ReportRow = typeof reports.$inferSelect;

/** null の列を、キーごと取り除く（契約では、ない値は「省略」で表す） */
function dropNulls(row: object): Record<string, unknown> {
  return Object.fromEntries(Object.entries(row).filter(([, value]) => value !== null));
}

export const toDesign = (row: DesignRow): Design => designSchema.parse(dropNulls(row));
export const toOrder = (row: OrderRow): Order => orderSchema.parse(dropNulls(row));
export const toOrderItem = (row: OrderItemRow): OrderItem => orderItemSchema.parse(dropNulls(row));
export const toPrintSheet = (row: PrintSheetRow): PrintSheet =>
  printSheetSchema.parse(dropNulls(row));
export const toPrintSlot = (row: PrintSlotRow): PrintSlot => printSlotSchema.parse(dropNulls(row));
export const toArchiveEntry = (row: ArchiveEntryRow): ArchiveEntry =>
  archiveEntrySchema.parse(dropNulls(row));
export const toReport = (row: ReportRow): Report => reportSchema.parse(dropNulls(row));

/** 設定の businessDate と busyMessage は、契約で nullable なので、null のまま渡す */
export const toSetting = (row: SettingRow): Setting => settingSchema.parse(row);

/** seq は DB 内部の通し番号なので、契約の AuditLog には含めない */
export const toAuditLog = (row: AuditLogRow): AuditLog => auditLogSchema.parse(dropNulls(row));
