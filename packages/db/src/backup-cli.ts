// バックアップを 1 回取る。タスクスケジューラが、数分おきに呼ぶ（infra/windows/register-backup-task.ps1）。
// 置き場所は環境変数 BACKUP_DIR（処理PC とは別の物理ドライブ）、残す数は BACKUP_KEEP。
import { isAbsolute, resolve } from "node:path";
import { backupData, DEFAULT_KEEP } from "./backup";
import { findRepoRoot, resolveDataDir } from "./paths";

const configured = process.env.BACKUP_DIR;
if (!configured) {
  console.error(
    "BACKUP_DIR が設定されていません。.env に、バックアップ先のフォルダを書いてください",
  );
  process.exit(1);
}
const backupDir = isAbsolute(configured) ? configured : resolve(findRepoRoot(), configured);

const keep = process.env.BACKUP_KEEP ? Number(process.env.BACKUP_KEEP) : DEFAULT_KEEP;
if (!Number.isInteger(keep) || keep < 1) {
  console.error(`BACKUP_KEEP は 1 以上の整数にしてください: ${process.env.BACKUP_KEEP}`);
  process.exit(1);
}

try {
  const result = backupData({ dataDir: resolveDataDir(), backupDir, keep });
  console.log(
    `${new Date().toISOString()} バックアップ完了: ${result.snapshotDir}` +
      `（画像 ${result.imagesCopied} 件を追加、全 ${result.imagesTotal} 件。古いスナップショット ${result.pruned} 件を削除）`,
  );
} catch (error) {
  console.error(
    `${new Date().toISOString()} バックアップに失敗しました: ${(error as Error).message}`,
  );
  process.exit(1);
}
