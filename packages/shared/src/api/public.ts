import { z } from "zod";
import { editorDataSchema } from "../entities/design";
import {
  confirmationCodeInputSchema,
  confirmationCodeSchema,
  idSchema,
  orderIdSchema,
  orderNumberSchema,
} from "../ids";
import { isoDateSchema, isoDateTimeSchema, quantitySchema, yenSchema } from "../primitives";
import { acceptanceSchema, orderItemStatusSchema, orderStatusSchema } from "../status";

// 来場者向け（認証なし）。本人の判定は匿名トークンの Cookie で、api が読む

/** GET /api/status。注文ボタンを出してよいかと、待ち件数 */
export const statusResponseSchema = z.object({
  acceptance: acceptanceSchema,
  /** acceptance が busy のとき、注文ボタンの代わりに見せる案内文 */
  busyMessage: z.string().nullable(),
  price: yenSchema,
  /** 1 のとき、画面は個数の選択を出さない */
  maxQuantityPerOrder: quantitySchema,
  waitingCount: z.int().nonnegative(),
});
export type StatusResponse = z.infer<typeof statusResponseSchema>;

/** POST /api/images（multipart）の応答。15 分以内に注文に使われない画像は削除される */
export const imageUploadResponseSchema = z.object({ imageId: idSchema });
export type ImageUploadResponse = z.infer<typeof imageUploadResponseSchema>;

/** POST /api/orders */
export const createOrderRequestSchema = z.object({
  imageId: idSchema,
  editorData: editorDataSchema,
  /** 原則 1。上限は Setting.maxQuantityPerOrder */
  quantity: quantitySchema,
  turnstileToken: z.string().min(1),
  /** 持ち込み画像の権利確認への同意（spec.md 11.4）。同意しないと注文できない */
  rightsConsent: z.literal(true),
});
export type CreateOrderRequest = z.infer<typeof createOrderRequestSchema>;

export const createOrderResponseSchema = z.object({ orderId: orderIdSchema });
export type CreateOrderResponse = z.infer<typeof createOrderResponseSchema>;

/** 注文状況ページに出す、バッジ 1 個分 */
export const orderItemViewSchema = z.object({
  id: idSchema,
  quantity: quantitySchema,
  status: orderItemStatusSchema,
  imageUrl: z.string(),
  thumbnailUrl: z.string(),
});
export type OrderItemView = z.infer<typeof orderItemViewSchema>;

/**
 * GET /api/orders/:orderId など、来場者の注文状況ページに返す形。
 * 本人が QR・注文番号・確認コードをレジと受け渡しで見せるので、確認コードを含む。
 * 匿名トークンは含めない
 */
export const orderViewSchema = z.object({
  id: orderIdSchema,
  businessDate: isoDateSchema,
  orderNumber: orderNumberSchema,
  /** orderNumber を、設定の桁数でゼロ埋めした表示用の文字列 */
  orderNumberText: z.string(),
  confirmationCode: confirmationCodeSchema,
  status: orderStatusSchema,
  totalAmount: yenSchema,
  createdAt: isoDateTimeSchema,
  paidAt: isoDateTimeSchema.optional(),
  readyAt: isoDateTimeSchema.optional(),
  pickedUpAt: isoDateTimeSchema.optional(),
  items: z.array(orderItemViewSchema),
});
export type OrderView = z.infer<typeof orderViewSchema>;

/** POST /api/orders/lookup。端末を変えた人が、注文番号と確認コードで注文を開く。番号は当日の営業日の注文 */
export const lookupOrderRequestSchema = z.object({
  orderNumber: orderNumberSchema,
  confirmationCode: confirmationCodeInputSchema,
});
export type LookupOrderRequest = z.infer<typeof lookupOrderRequestSchema>;

export const lookupOrderResponseSchema = z.object({ orderId: orderIdSchema });
export type LookupOrderResponse = z.infer<typeof lookupOrderResponseSchema>;

/** Discord アイコンの取り込みの戻り（W08）。失敗時は error が付く */
export const discordCallbackQuerySchema = z.object({
  code: z.string().optional(),
  state: z.string().optional(),
  error: z.string().optional(),
});
export type DiscordCallbackQuery = z.infer<typeof discordCallbackQuerySchema>;
