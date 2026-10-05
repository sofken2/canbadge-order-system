import type { Database, Tx } from "./connection";
import { newId } from "./generate";

/** 1 回の書き込み操作の文脈。at は操作の時刻（ISO 8601）で、操作の中のすべての記録に同じ値を使う */
export type Ctx = { tx: Tx; at: string };

/**
 * 書き込みのトランザクション。最初に書き込みロックを取る（immediate）ので、
 * 読んでから書く操作が、別のプロセスと途中で入れ違いにならない。
 * 途中で例外が出れば、状態の変更も操作ログも、すべて取り消される
 */
export function write<T>(db: Database, fn: (ctx: Ctx) => T): T {
  const at = db.now().toISOString();
  return db.orm.transaction((tx) => fn({ tx, at }), { behavior: "immediate" });
}

/** 操作の時刻で作る ID。時刻を固定したテストでも、ID が時刻順に並ぶ */
export function idAt(ctx: Ctx): string {
  return newId(new Date(ctx.at));
}
