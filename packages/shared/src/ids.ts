import { z } from "zod";

/**
 * 内部で使う ID（注文・明細・デザイン・シートなど）。ULID（時刻順に並ぶ、推測できない 26 文字）。
 * 注文 ID は注文 QR の中身と注文状況ページの URL になる。連番にしないのは、
 * 番号の総当たりで他人の注文を覗かれないようにするため（spec.md 5章）
 */
export const idSchema = z.ulid();
export type Id = z.infer<typeof idSchema>;

/** 注文 ID。QR の中身は、この ID に確認コードを足したもの（orderQrValue）。ID だけでも読める */
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
 * 注文 QR の中身。「注文 ID-確認コード」。スタッフが受け渡しで読むと、確認コードが自動で入る。
 * 来場者の端末にある確認コードを、QR に含めただけで、新しい秘密は増えない（注文状況の画面にも出ている）。
 * 区切りは、ハンディスキャナー（キーボード入力）でも打ち間違えにくい「-」。ID だけの古い QR も、読める
 */
export function orderQrValue(orderId: string, confirmationCode: string): string {
  return `${orderId}-${confirmationCode}`;
}

/** 注文 QR の中身を読む。形が違えば undefined（ID だけの QR は、parseOrderQr では読まない） */
export function parseOrderQr(
  text: string,
): { orderId: string; confirmationCode: string } | undefined {
  const [orderId, confirmationCode, ...rest] = text
    .normalize("NFKC")
    .trim()
    .toUpperCase()
    .split("-");
  if (rest.length > 0 || orderId === undefined || confirmationCode === undefined) return undefined;
  if (!idSchema.safeParse(orderId).success) return undefined;
  if (!confirmationCodePattern.test(confirmationCode)) return undefined;
  return { orderId, confirmationCode };
}

/**
 * 匿名トークン。ブラウザの Cookie に入れるランダム値で、来場者本人の注文・投稿を判定する。
 * 画面には返さない（api が Cookie から読む）
 */
export const anonTokenSchema = z.string().min(16).max(128);
