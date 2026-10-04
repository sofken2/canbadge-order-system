import { z } from "zod";
import { idSchema } from "../ids";
import { isoDateTimeSchema } from "../primitives";
import { actorSchema } from "../status";

export const auditTargetTypeSchema = z.enum([
  "order",
  "order_item",
  "print_sheet",
  "setting",
  "archive_entry",
  "report",
]);
export type AuditTargetType = z.infer<typeof auditTargetTypeSchema>;

/**
 * スタッフ操作と状態変更の記録。遷移関数が、状態の変更と同じトランザクションで書く。
 * api は「前回確認した以降の行」を読んで SSE を流す（print-worker の変更もここ経由で拾う）
 */
export const auditLogSchema = z.object({
  id: idSchema,
  actor: actorSchema,
  at: isoDateTimeSchema,
  /** 操作名（例: "pay"、"reprint"、"business_day_open"）。遷移は from と to を detail に入れる */
  action: z.string().min(1).max(64),
  targetType: auditTargetTypeSchema,
  targetId: z.string().min(1),
  detail: z.record(z.string(), z.unknown()).optional(),
});
export type AuditLog = z.infer<typeof auditLogSchema>;
