import { Database as SqliteDatabase } from "bun:sqlite";
import { mkdirSync } from "node:fs";
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
 * DB を開く。api と print-worker の 2 つのプロセスが同じファイルを使うので、
 * WAL モード（読み取りと書き込みが互いを止めない）と、ロックを待つ時間（ビジータイムアウト）を設定する
 */
export function openDatabase(options: OpenOptions): Database {
  if (options.path !== ":memory:") mkdirSync(dirname(options.path), { recursive: true });

  const sqlite = new SqliteDatabase(options.path, { create: true });
  sqlite.exec("PRAGMA journal_mode = WAL");
  sqlite.exec("PRAGMA busy_timeout = 5000");
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
    migrate(orm, { migrationsFolder });
    ensureSetting(db);
  }
  return db;
}
