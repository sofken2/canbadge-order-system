import { z } from "zod";

/** 注文全体の状態（spec.md 8.1） */
export const orderStatusSchema = z.enum([
  "submitted",
  "paid",
  "assembling",
  "ready",
  "picked_up",
  "expired",
  "cancelled",
  "refunded",
]);
export type OrderStatus = z.infer<typeof orderStatusSchema>;

/** 注文明細（バッジ）ごとの印刷の状態（spec.md 8.2） */
export const orderItemStatusSchema = z.enum(["queued", "printing", "printed"]);
export type OrderItemStatus = z.infer<typeof orderItemStatusSchema>;

/** 印刷した用紙 1 枚の状態。ドライバーが成功すれば confirmed（自動）。failed は、ドライバーが失敗して、用紙ごとやり直すとき */
export const printSheetStatusSchema = z.enum(["printing", "confirmed", "failed"]);
export type PrintSheetStatus = z.infer<typeof printSheetStatusSchema>;

/** シート上のバッジごとの結果。印刷が成功すれば ok、ドライバーが失敗してやり直すときは reprint（pending は、印刷中） */
export const printSlotResultSchema = z.enum(["pending", "ok", "reprint"]);
export type PrintSlotResult = z.infer<typeof printSlotResultSchema>;

/** アーカイブ作品の公開状態（spec.md 11.2）。アーカイブは優先度低 */
export const archiveStatusSchema = z.enum(["pending_review", "public", "rejected", "hidden"]);
export type ArchiveStatus = z.infer<typeof archiveStatusSchema>;

/** 通報への対応状況 */
export const reportStatusSchema = z.enum(["open", "resolved"]);
export type ReportStatus = z.infer<typeof reportStatusSchema>;

/** 注文の受付状態。スタッフ画面で切り替える */
export const acceptanceSchema = z.enum(["open", "busy", "closed"]);
export type Acceptance = z.infer<typeof acceptanceSchema>;

/** キラフィルムの柄。柄ごとに在庫を持つ。1 つの注文明細に貼れる柄は、1 種類 */
export const kiraPatternSchema = z.enum(["shards", "aurora"]);
export type KiraPattern = z.infer<typeof kiraPatternSchema>;

/** 操作の実行者。スタッフは個人を区別しない */
export const actorSchema = z.enum(["staff", "visitor", "system"]);
export type Actor = z.infer<typeof actorSchema>;

// 表示名。web と staff で表記が揃うよう、ここだけで持つ
export const orderStatusLabels: Record<OrderStatus, string> = {
  submitted: "支払い待ち",
  paid: "印刷待ち",
  // 印刷が終わると、自動でこの状態になる。組み立て待ちと、組み立て中を、分けない
  assembling: "組み立て中",
  ready: "受け取り可能",
  picked_up: "受け渡し済み",
  expired: "期限切れ",
  cancelled: "取り消し済み",
  refunded: "返金済み",
};

export const orderItemStatusLabels: Record<OrderItemStatus, string> = {
  queued: "印刷待ち",
  printing: "印刷中",
  printed: "印刷済み",
};

export const printSheetStatusLabels: Record<PrintSheetStatus, string> = {
  printing: "印刷中",
  confirmed: "確認済み",
  failed: "失敗",
};

export const printSlotResultLabels: Record<PrintSlotResult, string> = {
  pending: "未確認",
  ok: "OK",
  reprint: "再印刷",
};

export const archiveStatusLabels: Record<ArchiveStatus, string> = {
  pending_review: "審査待ち",
  public: "公開中",
  rejected: "却下",
  hidden: "非公開",
};

export const kiraPatternLabels: Record<KiraPattern, string> = {
  shards: "割れガラス",
  aurora: "オーロラ",
};

export const acceptanceLabels: Record<Acceptance, string> = {
  open: "受付中",
  busy: "混雑のため一時停止中",
  closed: "受付終了",
};
