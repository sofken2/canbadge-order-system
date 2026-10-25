import {
  completePrintSheet,
  type Database,
  getCurrentPrintSheet,
  listPrintSlots,
} from "@canbadge/db";

// 起動したときの、印刷の状態の確認（P02）。印刷の確認の操作はないので、印刷中のまま残ったシートは、
// 起動時に、印刷済みとして扱う（印刷のジョブは、シートを記録した直後に送るので、用紙は出ていることが多い）。
// **自動で印刷し直さない**：用紙がもう出ていたら、二重に印刷してしまうため。
// 出ていなかったバッジは、組み立ての担当が気づいて、スタッフ画面の「印刷」（履歴）から、バッジごとに、すぐ再印刷できる。

/** 起動時に出す知らせ（なければ、空）。印刷中のまま残ったシートを、印刷済みにして、その旨を知らせる */
export function recoverOnStartup(db: Database): string[] {
  const sheet = getCurrentPrintSheet(db);
  if (!sheet) return [];

  const slots = listPrintSlots(db.orm, sheet.id);
  const minutes = Math.max(
    0,
    Math.floor((db.now().getTime() - new Date(sheet.printedAt).getTime()) / 60000),
  );
  completePrintSheet(db, { sheetId: sheet.id, detail: { reason: "recovered_on_startup" } });
  return [
    `前回の終了時に、印刷中だったシート ${sheet.id}（${slots.length} 個・${minutes} 分前に印刷）を、印刷済みとして扱いました。` +
      "用紙が出ていないバッジは、スタッフ画面の「印刷」の履歴から、バッジごとに再印刷してください" +
      "（自動では、印刷し直しません。二重に印刷しないため）",
  ];
}
