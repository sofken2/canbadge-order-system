import {
  RESET_CONFIRM_TEXT,
  type ResetBlocker,
  type ResetCounts,
  type ResetEventResponse,
} from "@canbadge/shared";

// イベントデータのリセットの、画面から切り離した文言と判定（テストできるように）。

/** 実行できない理由。何が起きているか → どうすればよいか、の順 */
export const blockerCopy: Record<ResetBlocker, string> = {
  acceptance_not_closed: "受付が終了していません。先に、上の「受付を終了する」を押してください。",
  print_sheet_printing: "印刷中のシートがあります。印刷が終わると、押せるようになります。",
};

/** 確認の文字が、合っているか。前後の空白は、見逃す（打ち込みやすいように） */
export const isResetConfirmed = (input: string): boolean => input.trim() === RESET_CONFIRM_TEXT;

/** 消えるものの、1 行の説明 */
export function deletedLine(counts: ResetCounts): string {
  return `消えるもの：注文 ${counts.orders} 件（売上を含む）・印刷シート ${counts.printSheets} 枚・アーカイブの作品 ${counts.archiveEntries} 件と通報 ${counts.reports} 件`;
}

/** まだ終わっていない注文があるときの、注意。本物の注文を、消さないように */
export function unfinishedWarning(counts: ResetCounts): string | undefined {
  return counts.unfinishedOrders > 0
    ? `まだ終わっていない注文が ${counts.unfinishedOrders} 件あります。本物の注文なら、押さないでください。`
    : undefined;
}

export function doneMessage(result: ResetEventResponse): string {
  return `リセットしました（注文 ${result.deleted.orders} 件・アーカイブ ${result.deleted.archiveEntries} 件を消しました）。消す前のデータは、データ置き場の ${result.backupName} に残してあります。営業を始めるときは、「営業を開始する」を押してください`;
}
