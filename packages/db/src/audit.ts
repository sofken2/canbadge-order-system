import type { Actor, AuditLog, AuditTargetType } from "@canbadge/shared";
import { and, asc, eq, gt, max } from "drizzle-orm";
import type { Database } from "./connection";
import { toAuditLog } from "./rows";
import { auditLogs } from "./schema";
import { type Ctx, idAt } from "./transaction";

export type AuditEntry = {
  actor: Actor;
  /** 操作名。例: "order.transition"、"reprint"、"business_day.open" */
  action: string;
  targetType: AuditTargetType;
  targetId: string;
  detail?: Record<string, unknown>;
};

/** 操作ログを書く。状態の変更と同じトランザクションの中で呼ぶ（別々に書くと、片方だけ残りうる） */
export function writeAudit(ctx: Ctx, entry: AuditEntry): void {
  ctx.tx
    .insert(auditLogs)
    .values({
      id: idAt(ctx),
      actor: entry.actor,
      at: ctx.at,
      action: entry.action,
      targetType: entry.targetType,
      targetId: entry.targetId,
      detail: entry.detail ?? null,
    })
    .run();
}

/**
 * 通し番号（seq）が afterSeq より後の操作ログを、古い順に返す。
 * api はこれを数秒ごとに読み、print-worker の変更も含めて SSE を流す
 */
export function listAuditLogsSince(
  db: Database,
  afterSeq: number,
  limit = 200,
): { seq: number; log: AuditLog }[] {
  return db.orm
    .select()
    .from(auditLogs)
    .where(gt(auditLogs.seq, afterSeq))
    .orderBy(asc(auditLogs.seq))
    .limit(limit)
    .all()
    .map((row) => ({ seq: row.seq, log: toAuditLog(row) }));
}

/** いまの操作ログの、いちばん後ろの通し番号（なければ 0）。ここより後の操作だけを見たいときの起点にする */
export function latestAuditSeq(db: Database): number {
  const row = db.orm
    .select({ seq: max(auditLogs.seq) })
    .from(auditLogs)
    .get();
  return row?.seq ?? 0;
}

/** afterSeq より後で、指定した操作の、いちばん新しい通し番号。なければ undefined */
export function latestAuditSeqOf(
  db: Database,
  afterSeq: number,
  action: string,
): number | undefined {
  const row = db.orm
    .select({ seq: max(auditLogs.seq) })
    .from(auditLogs)
    .where(and(gt(auditLogs.seq, afterSeq), eq(auditLogs.action, action)))
    .get();
  return row?.seq ?? undefined;
}
