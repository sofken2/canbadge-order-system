import { Database as SqliteDatabase } from "bun:sqlite";
import { existsSync, mkdirSync, rmSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { type BunSQLiteDatabase, drizzle } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import * as schema from "./schema";
import { ensureSetting } from "./settings";

export type Orm = BunSQLiteDatabase<typeof schema>;
/** トランザクションの中で使う、Orm と同じ形の口 */
export type Tx = Parameters<Parameters<Orm["transaction"]>[0]>[0];
/** 読み取りだけに使う口。Orm でもトランザクションでも渡せる */
export type Reader = Pick<Orm, "select">;
/** 現在時刻。テストやサンプルデータで時刻を固定するために差し替えられる */
export type Clock = () => Date;

export type Database = {
  orm: Orm;
  sqlite: SqliteDatabase;
  now: Clock;
  close: () => void;
};

export type OpenOptions = {
  /** DB ファイルのパス。":memory:" ならメモリ上（テスト用） */
  path: string;
  now?: Clock;
  /** マイグレーションを実行し、設定の行を用意する。既定は true */
  migrate?: boolean;
};

const migrationsFolder = join(import.meta.dir, "..", "drizzle");

/**
 * フォルダがなければ作る。Windows では、ほかのプロセスが同じフォルダの中を操作している最中だと、
 * 存在するフォルダへの mkdir が EPERM になることがある。フォルダがあれば、それでよい
 */
function ensureDirectory(path: string): void {
  if (existsSync(path)) return;
  try {
    mkdirSync(path, { recursive: true });
  } catch (error) {
    if (!existsSync(path)) throw error;
  }
}

/**
 * マイグレーションを、プロセスをまたいで 1 つずつ行うためのロック。
 * 空の DB に、api と print-worker が同時に起動すると、両方がテーブルを作ろうとして失敗するため。
 * ロックは、フォルダを作れたかどうか（作成は一度に 1 つのプロセスしか成功しない）で取る。
 * プロセスが落ちて残ったロックは、一定時間たったら取り上げる
 */
const LOCK_TIMEOUT_MS = 20_000;
const STALE_LOCK_MS = 30_000;

function withMigrationLock<T>(dbPath: string, run: () => T): T {
  if (dbPath === ":memory:") return run();

  const lock = `${dbPath}.migrate-lock`;
  const deadline = Date.now() + LOCK_TIMEOUT_MS;
  for (;;) {
    try {
      mkdirSync(lock);
      break;
    } catch (error) {
      // Windows では、別のプロセスが消している途中のフォルダを作ろうとすると、EEXIST ではなく EPERM などになる
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "EEXIST" && code !== "EPERM" && code !== "EBUSY" && code !== "EACCES")
        throw error;
      try {
        if (Date.now() - statSync(lock).mtimeMs > STALE_LOCK_MS)
          rmSync(lock, { recursive: true, force: true });
      } catch {
        // 別のプロセスが、ちょうどロックを手放した
      }
      if (Date.now() > deadline) {
        throw new Error(
          `マイグレーションのロックを取れませんでした（${lock}）。古いロックなら、フォルダを消してください`,
        );
      }
      Bun.sleepSync(50);
    }
  }
  try {
    return run();
  } finally {
    rmSync(lock, { recursive: true, force: true });
  }
}

/**
 * DB を開く。api と print-worker の 2 つのプロセスが同じファイルを使うので、
 * WAL モード（読み取りと書き込みが互いを止めない）と、ロックを待つ時間（ビジータイムアウト）を設定する
 */
export function openDatabase(options: OpenOptions): Database {
  if (options.path !== ":memory:") ensureDirectory(dirname(options.path));

  const sqlite = new SqliteDatabase(options.path, { create: true });
  // ロックを待つ時間は、最初に設定する（WAL への切り替えも、ほかの接続がロックを持っていると待たされるため）
  sqlite.exec("PRAGMA busy_timeout = 5000");
  sqlite.exec("PRAGMA journal_mode = WAL");
  sqlite.exec("PRAGMA synchronous = NORMAL");
  // 外部キーは接続ごとの設定で、SQLite の既定では無効
  sqlite.exec("PRAGMA foreign_keys = ON");

  const orm = drizzle(sqlite, { schema });
  const db: Database = {
    orm,
    sqlite,
    now: options.now ?? (() => new Date()),
    close: () => {
      // clearQueryCache は実行時には存在するが、@types/bun の型定義にはない
      (sqlite as SqliteDatabase & { clearQueryCache?: () => void }).clearQueryCache?.();
      sqlite.close();
      // Bun は、使い終わっていないステートメントがあると、接続とファイルを閉じるのを遅らせる。
      // Windows ではその間ファイルを消せない（テストの後片付けなど）ので、GC で解放を促す
      Bun.gc(true);
    },
  };

  if (options.migrate ?? true) {
    withMigrationLock(options.path, () => {
      migrate(orm, { migrationsFolder });
      ensureSetting(db);
    });
  }
  return db;
}
