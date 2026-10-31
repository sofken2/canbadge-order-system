import { describe, expect, test } from "bun:test";
import type {
  ArchiveEntry,
  AuditLog,
  Design,
  Order,
  OrderItem,
  PrintSheet,
  PrintSlot,
  Report,
  Setting,
} from "@canbadge/shared";
import {
  type ArchiveEntryRow,
  type AuditLogRow,
  type DesignRow,
  type OrderItemRow,
  type OrderRow,
  type PrintSheetRow,
  type PrintSlotRow,
  type ReportRow,
  type SettingRow,
  toOrder,
} from "./rows";

// 型の正本は shared の zod スキーマで、DB のテーブル定義はそれに合わせる。
// ずれたら、ここの型がコンパイルエラーになる（テストの実行ではなく、typecheck で見つかる）。

/** 行の null を「ない」（省略可）にした型 */
type NullToOptional<T> = {
  [K in keyof T as null extends T[K] ? K : never]?: Exclude<T[K], null>;
} & {
  [K in keyof T as null extends T[K] ? never : K]: T[K];
};

/** A と B が、互いに代入できる（同じ形である） */
type SameShape<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;

const designMatches: SameShape<NullToOptional<DesignRow>, Design> = true;
const orderMatches: SameShape<NullToOptional<OrderRow>, Order> = true;
// kiraPattern は、契約で nullable（キラフィルムなしは null）なので、null のまま持つ
const itemMatches: SameShape<
  NullToOptional<Omit<OrderItemRow, "kiraPattern">> & Pick<OrderItemRow, "kiraPattern">,
  OrderItem
> = true;
const sheetMatches: SameShape<NullToOptional<PrintSheetRow>, PrintSheet> = true;
const slotMatches: SameShape<NullToOptional<PrintSlotRow>, PrintSlot> = true;
const archiveMatches: SameShape<NullToOptional<ArchiveEntryRow>, ArchiveEntry> = true;
const reportMatches: SameShape<NullToOptional<ReportRow>, Report> = true;
// 設定は、契約で nullable な列（businessDate・busyMessage）を null のまま持つ。id は DB 内部
const settingMatches: SameShape<Omit<SettingRow, "id">, Setting> = true;
// seq は DB 内部の通し番号
const auditMatches: SameShape<NullToOptional<Omit<AuditLogRow, "seq">>, AuditLog> = true;

describe("DB の行と契約のエンティティ", () => {
  test("型が一致している（typecheck で検証済み）", () => {
    expect([
      designMatches,
      orderMatches,
      itemMatches,
      sheetMatches,
      slotMatches,
      archiveMatches,
      reportMatches,
      settingMatches,
      auditMatches,
    ]).toEqual(Array(9).fill(true));
  });

  const row: OrderRow = {
    id: "01HZX3V5Q8N4M6T2B9C7D1E0FA",
    businessDate: "2026-11-03",
    orderNumber: 1,
    confirmationCode: "K7QH",
    anonToken: "a".repeat(32),
    status: "submitted",
    totalAmount: 300,
    createdAt: "2026-11-03T00:00:00.000Z",
    paidAt: null,
    readyAt: null,
    pickedUpAt: null,
    refundedAt: null,
  };

  test("null の列は、キーごと省略して返す", () => {
    const order = toOrder(row);
    expect(order.paidAt).toBeUndefined();
    expect("paidAt" in order).toBe(false);
    expect(Object.keys(order).sort()).toEqual(
      [
        "anonToken",
        "businessDate",
        "confirmationCode",
        "createdAt",
        "id",
        "orderNumber",
        "status",
        "totalAmount",
      ].sort(),
    );
  });

  test("DB に契約に合わない値があれば、読み出すときに例外になる", () => {
    expect(() => toOrder({ ...row, totalAmount: -5 })).toThrow();
    expect(() => toOrder({ ...row, confirmationCode: "0000" })).toThrow();
  });
});
