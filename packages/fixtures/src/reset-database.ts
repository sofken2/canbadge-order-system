import { existsSync, rmSync } from "node:fs";
import { databasePath, imagesDir, openDatabase, sheetsDir } from "@canbadge/db";
import { SEED_MARKER_ACTION, type SeedSummary, seedSampleData } from "./seed";

export type ResetOptions = {
  dataDir: string;
  /** サンプルデータ以外の注文があっても消す。本番のデータを消してしまうので、普段は使わない */
  force?: boolean;
  now?: Date;
};

/**
 * 消してよい DB かを確かめる。注文が 1 件もないか、注文がサンプルデータだけのときだけ消せる。
 * サンプルのあとに本物の注文が入った DB（学祭の当日のデータ）を、うっかり消さないための確認
 */
function assertSafeToReset(path: string): void {
  if (!existsSync(path)) return;

  const db = openDatabase({ path, migrate: false });
  try {
    const orders = (db.sqlite.query("SELECT count(*) AS n FROM orders").get() as { n: number }).n;
    if (orders === 0) return;
    const marker = db.sqlite
      .query("SELECT detail FROM audit_logs WHERE action = ? ORDER BY seq DESC LIMIT 1")
      .get(SEED_MARKER_ACTION) as { detail: string | null } | null;
    const seeded = marker?.detail
      ? (JSON.parse(marker.detail) as { orders?: number }).orders
      : undefined;
    if (seeded === orders) return;
    throw new Error(
      `${path} には、サンプルデータ以外の注文が ${orders} 件あります。消してよいことを確かめたうえで、「bun run db:reset:force」で実行してください`,
    );
  } finally {
    db.close();
  }
}

/** ファイルを消す。api などが DB を開いたままだと消せないので、その場合は分かりやすく伝える */
function remove(path: string): void {
  try {
    rmSync(path, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  } catch (error) {
    throw new Error(
      `${path} を消せませんでした。api や print-worker など、DB を使っているプロセスを止めてからやり直してください（${String(error)}）`,
    );
  }
}

/** DB と画像・PDF を消して作り直し、サンプルデータを入れる */
export function resetAndSeed(options: ResetOptions): SeedSummary {
  const path = databasePath(options.dataDir);
  if (!options.force) assertSafeToReset(path);

  for (const file of [path, `${path}-wal`, `${path}-shm`]) remove(file);
  remove(imagesDir(options.dataDir));
  remove(sheetsDir(options.dataDir));
  return seedSampleData({ dataDir: options.dataDir, ...(options.now ? { now: options.now } : {}) });
}
