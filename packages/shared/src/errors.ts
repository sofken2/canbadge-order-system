import { z } from "zod";
import { acceptanceSchema } from "./status";

/** API のエラーの種類。画面は code で分岐し、message をそのまま表示する */
export const errorCodeSchema = z.enum([
  "VALIDATION_FAILED",
  "UNAUTHORIZED",
  "NOT_FOUND",
  "INVALID_TRANSITION",
  "CONFLICT",
  "CONFIRMATION_MISMATCH",
  "PAYLOAD_TOO_LARGE",
  "UNSUPPORTED_MEDIA_TYPE",
  "RATE_LIMITED",
  "NOT_ACCEPTING",
  "INTERNAL",
]);
export type ErrorCode = z.infer<typeof errorCodeSchema>;

/** code ごとの HTTP ステータス。api はこの表で返し、画面は想定外の組み合わせを疑える */
export const errorHttpStatus: Record<ErrorCode, number> = {
  VALIDATION_FAILED: 400,
  UNAUTHORIZED: 401,
  // 注文照会の失敗もこれにして、番号と確認コードのどちらが違うかは教えない
  NOT_FOUND: 404,
  // 遷移表にない操作（例: 支払い済みの注文をもう一度支払う）
  INVALID_TRANSITION: 409,
  // 同時操作で、先に状態が変わっていた
  CONFLICT: 409,
  CONFIRMATION_MISMATCH: 409,
  PAYLOAD_TOO_LARGE: 413,
  UNSUPPORTED_MEDIA_TYPE: 415,
  RATE_LIMITED: 429,
  NOT_ACCEPTING: 503,
  INTERNAL: 500,
};

/** 失敗時の本体。成功時はデータをそのまま返し、この形では包まない */
export const apiErrorSchema = z.object({
  error: z.object({
    code: errorCodeSchema,
    /** 画面にそのまま出せる日本語 */
    message: z.string(),
    /** VALIDATION_FAILED では項目ごとのエラー、NOT_ACCEPTING では notAcceptingDetailsSchema */
    details: z.unknown().optional(),
  }),
});
export type ApiError = z.infer<typeof apiErrorSchema>;

/** NOT_ACCEPTING（503）の details */
export const notAcceptingDetailsSchema = z.object({
  acceptance: acceptanceSchema,
  busyMessage: z.string().nullable(),
});
export type NotAcceptingDetails = z.infer<typeof notAcceptingDetailsSchema>;
