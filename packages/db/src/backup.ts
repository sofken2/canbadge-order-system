import { Database as SqliteDatabase } from "bun:sqlite";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join } from "node:path";
import { databasePath, imagesDir } from "./paths";

// 処理PC の故障に備えた、DB と画像のバックアップと復旧（I04）。
//
// 置き場所の構成（backupDir の下）:
//   snapshots/<yyyyMMdd-HHmmss>/app.db   DB の、ある時点の整合性のあるコピー
//   images/<ファイル名>                  画像。名前は ID で、一度作ったら変わらないので、増えた分だけ足す
//   latest.json                          直近の成功の記録（監視用）

/** 古いものから消して、残すスナップショットの数。5 分おきなら 24 時間分 */
export const DEFAULT_KEEP = 288;

const SNAPSHOT_NAME = /^\d{8}-\d{6}$/;
const PARTIAL_SUFFIX = ".partial";

export type BackupOptions = {
  /** データ置き場（app.db と images/ がある場所） */
  dataDir: string;
  /** バックアップの置き場所。処理PC とは別の物理ドライブ（外付けドライブなど）にする */
  backupDir: string;
  keep?: number;
  now?: Date;
};

export type BackupResult = {
  snapshotDir: string;
  imagesCopied: number;
  imagesTotal: number;
  pruned: number;
};

const pad = (value: number, width = 2): string => String(value).padStart(width, "0");

/** スナップショットのフォルダ名。並べ替えで新旧がわかるよう、ローカル時刻の固定幅にする */
export function snapshotName(date: Date): string {
  return (
    `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}` +
    `-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
  );
}

function ensureDirectory(path: string): void {
  mkdirSync(path, { recursive: true });
}

/**
 * DB ファイルが壊れていないか確かめる。ファイルを書き込み中にコピーすると壊れるため、
 * バックアップは必ずこれを通してから、完成として扱う
 */
export function verifyDatabase(path: string): void {
  if (!existsSync(path)) throw new Error(`DB ファイルがありません: ${path}`);
  const sqlite = new SqliteDatabase(path, { readonly: true });
  try {
    const rows = sqlite.query("PRAGMA integrity_check").all() as { integrity_check: string }[];
    const problems = rows.map((row) => row.integrity_check).filter((text) => text !== "ok");
    if (problems.length > 0) throw new Error(`DB が壊れています: ${problems.join(" / ")}`);
    const tables = sqlite
      .query("SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table'")
      .get() as {
      n: number;
    };
    if (tables.n === 0) throw new Error(`DB にテーブルがありません: ${path}`);
  } finally {
    sqlite.close();
  }
}

/**
 * 画像を、まだないものだけコピーする。画像は ID の名前で、書き込まれたあと変わらないので、
 * 名前と大きさが同じなら同じものとして飛ばす。コピー先からは何も消さない（消したものも残る）
 */
function copyMissingFiles(fromDir: string, toDir: string): { copied: number; total: number } {
  if (!existsSync(fromDir)) return { copied: 0, total: 0 };
  ensureDirectory(toDir);
  let copied = 0;
  let total = 0;
  for (const entry of readdirSync(fromDir, { withFileTypes: true })) {
    if (!entry.isFile()) continue;
    total += 1;
    const source = join(fromDir, entry.name);
    const target = join(toDir, entry.name);
    if (existsSync(target) && statSync(target).size === statSync(source).size) continue;
    // 書き込み途中のファイルを見せないよう、一時名で書いてから置き換える
    const temporary = `${target}.tmp`;
    copyFileSync(source, temporary);
    renameSync(temporary, target);
    copied += 1;
  }
  return { copied, total };
}

function listSnapshots(backupDir: string): string[] {
  const root = join(backupDir, "snapshots");
  if (!existsSync(root)) return [];
  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && SNAPSHOT_NAME.test(entry.name))
    .map((entry) => entry.name)
    .sort();
}

/**
 * DB と画像のバックアップを 1 回取る。
 * DB は、書き込み中でも整合性のあるコピーを作れる `VACUUM INTO` で複製する
 * （稼働中のファイルをそのままコピーすると、壊れることがある）。
 * 一時のフォルダに作り、DB の検証と画像のコピーが済んでから、名前を変えて完成にする
 */
export function backupData(options: BackupOptions): BackupResult {
  const { dataDir, backupDir } = options;
  const keep = options.keep ?? DEFAULT_KEEP;
  const source = databasePath(dataDir);
  if (!existsSync(source)) throw new Error(`DB ファイルがありません: ${source}`);

  const snapshotsRoot = join(backupDir, "snapshots");
  ensureDirectory(snapshotsRoot);

  // 前回、途中で止まった一時のフォルダを片づける（バックアップは同時に 1 つしか動かさない前提）
  for (const entry of readdirSync(snapshotsRoot)) {
    if (entry.endsWith(PARTIAL_SUFFIX)) {
      rmSync(join(snapshotsRoot, entry), { recursive: true, force: true });
    }
  }

  const name = snapshotName(options.now ?? new Date());
  const finalDir = join(snapshotsRoot, name);
  if (existsSync(finalDir)) throw new Error(`同じ時刻のスナップショットがすでにあります: ${name}`);
  const partialDir = `${finalDir}${PARTIAL_SUFFIX}`;
  ensureDirectory(partialDir);

  const target = join(partialDir, "app.db");
  const sqlite = new SqliteDatabase(source, { readonly: true });
  try {
    sqlite.run("PRAGMA busy_timeout = 5000");
    // INTO の先は、文字列として渡す。クォートは SQL のルールに合わせて二重にする
    sqlite.run(`VACUUM INTO '${target.replaceAll("'", "''")}'`);
  } finally {
    sqlite.close();
  }
  verifyDatabase(target);

  // DB を先に複製し、画像をあとで足す。DB が参照する画像は、その時点より前に保存されているので、
  // 画像をあとでコピーすれば、スナップショットが参照する画像は必ず揃う
  const images = copyMissingFiles(imagesDir(dataDir), join(backupDir, "images"));

  renameSync(partialDir, finalDir);

  const snapshots = listSnapshots(backupDir);
  const stale = snapshots.slice(0, Math.max(0, snapshots.length - keep));
  for (const old of stale) rmSync(join(snapshotsRoot, old), { recursive: true, force: true });

  writeFileSync(
    join(backupDir, "latest.json"),
    `${JSON.stringify({ at: (options.now ?? new Date()).toISOString(), snapshot: name, images: images.total }, null, 2)}\n`,
  );

  return {
    snapshotDir: finalDir,
    imagesCopied: images.copied,
    imagesTotal: images.total,
    pruned: stale.length,
  };
}

export type RestoreOptions = {
  /** バックアップの置き場所（backupDir）、またはその中のスナップショットのフォルダ */
  from: string;
  dataDir: string;
  /** 復旧先にすでに DB があるとき、退避して置き換える */
  force?: boolean;
  now?: Date;
};

export type RestoreResult = {
  snapshotDir: string;
  imagesCopied: number;
  movedAside?: string;
};

/** 復旧元から、使うスナップショットを決める。backupDir を渡したら、完成している最新のもの */
function resolveSnapshot(from: string): { snapshotDir: string; backupDir: string } {
  if (existsSync(join(from, "app.db"))) {
    // スナップショットのフォルダを直接指定した。置き場所は、2 つ上
    return { snapshotDir: from, backupDir: dirname(dirname(from)) };
  }
  const names = listSnapshots(from);
  const latest = names[names.length - 1];
  if (!latest) throw new Error(`スナップショットが見つかりません: ${from}`);
  return { snapshotDir: join(from, "snapshots", latest), backupDir: from };
}

/**
 * バックアップから、データ置き場を復旧する。api と print-worker を止めてから実行する。
 * 復旧元の DB を検証してから置く。復旧先に DB が残っていると、その WAL・SHM が新しい DB と
 * 食い違って壊れるため、DB と一緒に必ず退避する（消さない）
 */
export function restoreData(options: RestoreOptions): RestoreResult {
  const { snapshotDir, backupDir } = resolveSnapshot(options.from);
  verifyDatabase(join(snapshotDir, "app.db"));

  const target = databasePath(options.dataDir);
  const companions = [target, `${target}-wal`, `${target}-shm`];
  let movedAside: string | undefined;

  if (companions.some((file) => existsSync(file))) {
    if (!options.force) {
      throw new Error(
        `復旧先に DB がすでにあります: ${target}。置き換えてよければ force を指定してください（今の DB は退避します）`,
      );
    }
    const stamp = snapshotName(options.now ?? new Date());
    movedAside = join(options.dataDir, `before-restore-${stamp}`);
    ensureDirectory(movedAside);
    for (const file of companions) {
      if (existsSync(file)) renameSync(file, join(movedAside, basename(file)));
    }
  }

  ensureDirectory(options.dataDir);
  copyFileSync(join(snapshotDir, "app.db"), target);
  const images = copyMissingFiles(join(backupDir, "images"), imagesDir(options.dataDir));

  return { snapshotDir, imagesCopied: images.copied, movedAside };
}
