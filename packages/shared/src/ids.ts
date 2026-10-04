import { z } from "zod";

/**
 * 内部で使う ID（注文・明細・デザイン・シートなど）。ULID（時刻順に並ぶ、推測できない 26 文字）。
 * 注文 ID は注文 QR の中身と注文状況ページの URL になる。連番にしないのは、
 * 番号の総当たりで他人の注文を覗かれないようにするため（spec.md 5章）
 */
export const idSchema = z.ulid();
export type Id = z.infer<typeof idSchema>;

/** 注文 ID。QR の中身は、この文字列だけにする */
export const orderIdSchema = idSchema;

/**
 * 注文番号。営業日ごとに 1 から振り直す人向けの短い番号。
 * 営業日（businessDate）との組で一意になる。表示は formatOrderNumber を通す
 */
export const orderNumberSchema = z.int().positive();

/** 注文番号を、設定の桁数でゼロ埋めして表示用の文字列にする。桁があふれても切り捨てない */
export function formatOrderNumber(orderNumber: number, digits: number): string {
  return String(orderNumber).padStart(digits, "0");
}

export const CONFIRMATION_CODE_LENGTH = 4;

/** 紛らわしい文字（0 O 1 I L）を除いた英大文字と数字。31 文字 */
export const CONFIRMATION_CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";

const confirmationCodePattern = new RegExp(
  `^[${CONFIRMATION_CODE_ALPHABET}]{${CONFIRMATION_CODE_LENGTH}}$`,
);

/** 保存・表示する確認コード。大文字だけを受け付ける */
export const confirmationCodeSchema = z.string().regex(confirmationCodePattern);

/** 来場者・スタッフが入力する確認コード。前後の空白を除き、小文字も大文字として受け付ける */
export const confirmationCodeInputSchema = z
  .string()
  .trim()
  .toUpperCase()
  .pipe(confirmationCodeSchema);

/**
 * 匿名トークン。ブラウザの Cookie に入れるランダム値で、来場者本人の注文・投稿を判定する。
 * 画面には返さない（api が Cookie から読む）
 */
export const anonTokenSchema = z.string().min(16).max(128);
