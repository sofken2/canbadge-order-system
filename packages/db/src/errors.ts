import type { ErrorCode } from "@canbadge/shared";

/** db が投げるエラーの種類。shared の ErrorCode の一部で、api はそのまま HTTP ステータスに対応させる */
export type DbErrorCode = Extract<
  ErrorCode,
  | "NOT_FOUND"
  | "INVALID_TRANSITION"
  | "CONFLICT"
  | "CONFIRMATION_MISMATCH"
  | "NOT_ACCEPTING"
  | "VALIDATION_FAILED"
>;

export class DbError extends Error {
  readonly code: DbErrorCode;
  readonly details?: unknown;

  /** message は画面にそのまま出せる日本語にする */
  constructor(code: DbErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = "DbError";
    this.code = code;
    this.details = details;
  }
}

export const notFound = (what: string): DbError =>
  new DbError("NOT_FOUND", `${what}が見つかりません`);

export const invalidTransition = (message: string, details?: unknown): DbError =>
  new DbError("INVALID_TRANSITION", message, details);

/** 同時操作で、読んだあとに先に状態が変わっていた */
export const conflict = (what: string): DbError =>
  new DbError(
    "CONFLICT",
    `${what}が他の操作で先に変更されました。画面を更新してやり直してください`,
  );

export const validationFailed = (message: string, details?: unknown): DbError =>
  new DbError("VALIDATION_FAILED", message, details);
