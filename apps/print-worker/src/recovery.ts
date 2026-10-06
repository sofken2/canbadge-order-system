import { existsSync } from "node:fs";
import { join } from "node:path";
import { type Database, getCurrentPrintSheet, listPrintSlots } from "@canbadge/db";

// 起動したときの、印刷の状態の確認（P02）。処理 PC が再起動しても、印刷を**自動でやり直さない**。
// 印刷中だったシートは、DB に「印刷中」で残っているので、印刷係が、用紙を見て、確認する（OK か再印刷）。
// 自動でやり直すと、用紙が、もう出ていたときに、二重に印刷してしまう。
// ここでは、そのシートがあることを、ログで、はっきり知らせるだけ。

/** この分数をこえて、印刷中のままのシートは、確認が忘れられている可能性が高いので、強く知らせる */
export const STALE_SHEET_MINUTES = 30;

/** 起動時に出す知らせ（なければ、空） */
export function describeStartup(db: Database, dataDir: string): string[] {
  const sheet = getCurrentPrintSheet(db);
  if (!sheet) return [];

  const slots = listPrintSlots(db.orm, sheet.id);
  const minutes = Math.max(
    0,
    Math.floor((db.now().getTime() - new Date(sheet.printedAt).getTime()) / 60000),
  );
  const messages = [
    `印刷中のシート ${sheet.id}（${slots.length} 個・${minutes} 分前に印刷）が、確認を待っています。` +
      "用紙が出ているかを確かめて、スタッフ画面の「印刷確認」で、OK か、再印刷を選んでください" +
      "（再起動のあとも、自動では、印刷し直しません。二重に印刷しないため）",
  ];
  if (minutes >= STALE_SHEET_MINUTES) {
    messages.push(
      `注意：このシートは ${minutes} 分間、確認されていません。次のシートは、これが済むまで、印刷されません`,
    );
  }
  if (!existsSync(join(dataDir, sheet.pdfPath))) {
    messages.push(
      `注意：このシートの PDF（${sheet.pdfPath}）が見つかりません。「再印刷」を選べば、バッジが印刷待ちに戻り、新しいシートで印刷されます`,
    );
  }
  return messages;
}
