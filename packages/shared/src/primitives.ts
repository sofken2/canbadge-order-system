import { z } from "zod";

/** 日時。ISO 8601。UTC（Z）でも +09:00 のようなオフセット付きでもよい */
export const isoDateTimeSchema = z.iso.datetime({ offset: true });

/** 日付（営業日など）。日本時間の "2026-11-03" の形 */
export const isoDateSchema = z.iso.date();

/** 金額。円の整数。小数は使わない */
export const yenSchema = z.int().nonnegative();

/** 1 以上の個数 */
export const quantitySchema = z.int().positive();

/**
 * データ置き場（DATA_DIR）からの相対パス。区切りは / だけ。
 * 絶対パスや .. を含むパスは、データ置き場の外を指せてしまうので受け付けない
 */
export const relativePathSchema = z
  .string()
  .min(1)
  .max(260)
  .refine(
    (path) =>
      !path.startsWith("/") &&
      !path.includes("\\") &&
      !/^[A-Za-z]:/.test(path) &&
      !path.split("/").includes(".."),
    "データ置き場からの相対パス（/ 区切り、.. なし）にしてください",
  );
