import { existsSync, mkdirSync, renameSync } from "node:fs";
import { join } from "node:path";
import type {
  Actor,
  OrderStatus,
  ResetBlocker,
  ResetCounts,
  ResetEventResponse,
  ResetSummary,
} from "@canbadge/shared";
import { count, eq, inArray } from "drizzle-orm";
import { writeAudit } from "./audit";
import { snapshotName, verifyDatabase } from "./backup";
import type { Database, Reader } from "./connection";
import { DbError } from "./errors";
import { imagesDir, sheetsDir } from "./paths";
import { getSetting } from "./queries";
import {
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
import { write } from "./transaction";

// イベントデータのリセット（テストのあと・本番の前）。注文・売上・印刷の履歴・アーカイブを消し、営業開始の前に戻す。
// 価格・上限・在庫の総数などの設定は残す。残りの数は、注文から数える（stock.ts）ので、注文を消せば、総数に戻る。
// 取り消せないので、消す前に、DB・画像・PDF を、データ置き場の old-<日時>/ に退避する。

/** まだ終わっていない注文。本物の注文なら、消してはいけない */
const UNFINISHED: readonly OrderStatus[] = ["submitted", "paid", "assembling", "ready"];

function tally(reader: Reader): ResetCounts {
  const total = (
    table: typeof orders | typeof printSheets | typeof archiveEntries | typeof reports,
  ) => reader.select({ n: count() }).from(table).get()?.n ?? 0;
  return {
    orders: total(orders),
    unfinishedOrders:
      reader
        .select({ n: count() })
        .from(orders)
        .where(inArray(orders.status, [...UNFINISHED]))
        .get()?.n ?? 0,
    printSheets: total(printSheets),
    archiveEntries: total(archiveEntries),
    reports: total(reports),
  };
}

function blockersOf(reader: Reader): ResetBlocker[] {
  const blockers: ResetBlocker[] = [];
  const setting = getSetting(reader);
  if (setting.acceptance !== "closed") blockers.push("acceptance_not_closed");
  const printing = reader
    .select({ n: count() })
    .from(printSheets)
    .where(eq(printSheets.status, "printing"))
    .get();
  if ((printing?.n ?? 0) > 0) blockers.push("print_sheet_printing");
  return blockers;
}

const BLOCKER_MESSAGES: Record<ResetBlocker, string> = {
  acceptance_not_closed: "受付が終了していません。先に「受付を終了する」を押してください",
  print_sheet_printing: "印刷中のシートがあります。印刷が終わってから、もう一度押してください",
};

/** リセットで消えるものの件数と、いま実行できるか（blockers が空なら実行できる） */
export function getResetSummary(db: Database): ResetSummary {
  return {
    acceptance: getSetting(db.orm).acceptance,
    counts: tally(db.orm),
    blockers: blockersOf(db.orm),
  };
}

function moveIfExists(from: string, to: string): void {
  if (existsSync(from)) renameSync(from, to);
}

/**
 * リセットを実行する。
 * 1. 条件を確かめる（受付終了中・印刷中のシートがない）
 * 2. 先に、DB・画像・PDF を、<データ置き場>/old-<日時>/ に退避する（DB は、稼働中でも整合性のある `VACUUM INTO`）
 * 3. 1 つのトランザクションで消す。印刷のワーカーが、確認のあとに、シートを作っていないかを、もう一度確かめる
 *    （操作ログは消さない。SSE は、ログの通し番号で、新しい操作を拾うので、番号を戻さない。リセットの記録を、1 件足す）
 * 4. 画像と PDF のフォルダを、退避先へ移し、空のフォルダを作り直す
 * 途中で失敗しても、退避した DB から戻せる。
 */
export function resetEventData(
  db: Database,
  input: { dataDir: string; actor: Actor },
): ResetEventResponse {
  const first = blockersOf(db.orm)[0];
  if (first) throw new DbError("INVALID_TRANSITION", BLOCKER_MESSAGES[first], { blocker: first });

  const backupName = `old-${snapshotName(db.now())}`;
  const backupDir = join(input.dataDir, backupName);
  if (existsSync(backupDir)) {
    throw new DbError(
      "CONFLICT",
      "同じ時刻の退避フォルダがすでにあります。少し待って、もう一度押してください",
    );
  }
  mkdirSync(backupDir, { recursive: true });
  const target = join(backupDir, "app.db");
  // INTO の先は、文字列として渡す。クォートは SQL のルールに合わせて二重にする
  db.sqlite.run(`VACUUM INTO '${target.replaceAll("'", "''")}'`);
  verifyDatabase(target);

  const deleted = write(db, (ctx) => {
    const blocker = blockersOf(ctx.tx)[0];
    if (blocker) throw new DbError("INVALID_TRANSITION", BLOCKER_MESSAGES[blocker], { blocker });
    const counts = tally(ctx.tx);

    // 参照している側（子）から消す
    ctx.tx.delete(printSlots).run();
    ctx.tx.delete(printSheets).run();
    ctx.tx.delete(reports).run();
    ctx.tx.delete(archiveEntries).run();
    ctx.tx.delete(orderItems).run();
    ctx.tx.delete(orders).run();
    ctx.tx.delete(designs).run();
    // 営業開始の前に戻す（注文番号は、営業開始で、1 から始まる）。受付は終了のまま
    ctx.tx
      .update(settings)
      .set({ businessDate: null, updatedAt: ctx.at })
      .where(eq(settings.id, 1))
      .run();
    ctx.tx.delete(auditLogs).run();
    // 通し番号（autoincrement）は残る。画面の更新の通知（SSE）を出すため、リセットの記録を 1 件足す
    writeAudit(ctx, {
      actor: input.actor,
      action: "event.reset",
      targetType: "setting",
      targetId: "1",
      detail: { backupName, deleted: counts },
    });
    return counts;
  });

  // DB を消したあとの片づけ。画像と PDF は、DB が空なので、どの注文からも指されていない
  moveIfExists(imagesDir(input.dataDir), join(backupDir, "images"));
  moveIfExists(sheetsDir(input.dataDir), join(backupDir, "sheets"));
  mkdirSync(imagesDir(input.dataDir), { recursive: true });
  mkdirSync(sheetsDir(input.dataDir), { recursive: true });

  return { backupName, deleted };
}
