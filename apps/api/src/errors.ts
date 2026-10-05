import { DbError } from "@canbadge/db";
import { type ApiError, type ErrorCode, errorHttpStatus } from "@canbadge/shared";
import { ZodError } from "zod";

/** api が投げるエラー。code は shared の ErrorCode で、HTTP ステータスは errorHttpStatus で決まる */
export class ApiException extends Error {
  readonly code: ErrorCode;
  readonly details?: unknown;

  /** message は画面にそのまま出せる日本語にする */
  constructor(code: ErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = "ApiException";
    this.code = code;
    this.details = details;
  }
}

export const notFound = (what: string): ApiException =>
  new ApiException("NOT_FOUND", `${what}が見つかりません`);

export const validationFailed = (message: string, details?: unknown): ApiException =>
  new ApiException("VALIDATION_FAILED", message, details);

/** 例外を、失敗時の本体（契約の ApiError）と HTTP ステータスにする */
export function toApiError(error: unknown): { status: number; body: ApiError } {
  const build = (code: ErrorCode, message: string, details?: unknown) => ({
    status: errorHttpStatus[code],
    body: {
      error: { code, message, ...(details === undefined ? {} : { details }) },
    } satisfies ApiError,
  });

  if (error instanceof ApiException) return build(error.code, error.message, error.details);
  if (error instanceof DbError) return build(error.code, error.message, error.details);
  if (error instanceof ZodError) {
    return build("VALIDATION_FAILED", "入力が正しくありません", error.issues);
  }
  // 想定外のエラー。詳細は画面に出さず、ログにだけ残す
  console.error("api: 想定外のエラー", error);
  return build("INTERNAL", "サーバーでエラーが起きました。もう一度お試しください");
}
