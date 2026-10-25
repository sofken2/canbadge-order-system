import type {
  Actor,
  ArchiveStatus,
  OrderItemStatus,
  OrderStatus,
  PrintSheetStatus,
} from "./status";

/**
 * 状態遷移表。「現在の状態 → 次の状態 → 実行できる役割」をデータで持つ。
 * 表にない遷移は packages/db の遷移関数が拒否する。検証の処理はここに書かない
 */
export type Transition<S extends string> = {
  readonly from: S;
  readonly to: S;
  readonly actors: readonly Actor[];
};

/** 注文の遷移（spec.md 8.1）。再印刷と返金の行は tasks.md の「印刷の確認・履歴・再印刷」を参照 */
export const orderTransitions = [
  { from: "submitted", to: "paid", actors: ["staff"] },
  // 受付終了の操作と、次の営業開始で、支払われなかった注文を失効させる
  { from: "submitted", to: "expired", actors: ["system"] },
  { from: "submitted", to: "cancelled", actors: ["visitor", "staff"] },
  // 全明細の印刷が終わったときに、遷移関数の中で自動で進む。印刷の確認と、組み立て開始の操作は、ない
  { from: "paid", to: "assembling", actors: ["system"] },
  { from: "assembling", to: "ready", actors: ["staff"] },
  { from: "ready", to: "picked_up", actors: ["staff"] },
  // 履歴からの再印刷。組み立て中や完成の注文も、印刷待ちに戻す
  { from: "assembling", to: "paid", actors: ["staff"] },
  { from: "ready", to: "paid", actors: ["staff"] },
  // 全額返金。支払い後のどの状態からでもできる
  { from: "paid", to: "refunded", actors: ["staff"] },
  { from: "assembling", to: "refunded", actors: ["staff"] },
  { from: "ready", to: "refunded", actors: ["staff"] },
  { from: "picked_up", to: "refunded", actors: ["staff"] },
] as const satisfies readonly Transition<OrderStatus>[];

/** 注文明細の遷移（spec.md 8.2） */
export const orderItemTransitions = [
  // print-worker が印刷シートに載せた
  { from: "queued", to: "printing", actors: ["system"] },
  // ドライバーが印刷のジョブを送れた（用紙の確認は、しない。足りなければ、履歴からバッジごとに再印刷する）
  { from: "printing", to: "printed", actors: ["system"] },
  // ドライバーが失敗した。印刷待ちに戻す
  { from: "printing", to: "queued", actors: ["system"] },
  // 履歴から再印刷を選んだ（組み立て中の破損など）
  { from: "printed", to: "queued", actors: ["staff"] },
] as const satisfies readonly Transition<OrderItemStatus>[];

/** 印刷シートの遷移 */
export const printSheetTransitions = [
  { from: "printing", to: "confirmed", actors: ["system"] },
  { from: "printing", to: "failed", actors: ["system"] },
] as const satisfies readonly Transition<PrintSheetStatus>[];

/** アーカイブ作品の遷移（spec.md 11.2）。アーカイブは優先度低 */
export const archiveTransitions = [
  { from: "pending_review", to: "public", actors: ["staff"] },
  { from: "pending_review", to: "rejected", actors: ["staff"] },
  // 通報への対応、または作者による取り下げ
  { from: "public", to: "hidden", actors: ["staff", "visitor"] },
] as const satisfies readonly Transition<ArchiveStatus>[];
