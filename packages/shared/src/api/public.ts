import { z } from "zod";
import { archiveEntrySchema } from "../entities/archive";
import { editorDataSchema } from "../entities/design";
import {
  confirmationCodeInputSchema,
  confirmationCodeSchema,
  idSchema,
  orderIdSchema,
  orderNumberSchema,
} from "../ids";
import {
  isoDateSchema,
  isoDateTimeSchema,
  quantitySchema,
  stockSchema,
  yenSchema,
} from "../primitives";
import {
  acceptanceSchema,
  archiveStatusSchema,
  kiraPatternSchema,
  orderItemStatusSchema,
  orderStatusSchema,
} from "../status";
import { pagedSchema, pageQuerySchema } from "./common";

// 来場者向け（認証なし）。本人の判定は匿名トークンの Cookie で、api が読む

/** GET /api/status。注文ボタンを出してよいかと、待ち件数 */
export const statusResponseSchema = z.object({
  acceptance: acceptanceSchema,
  /** acceptance が busy のとき、注文ボタンの代わりに見せる案内文 */
  busyMessage: z.string().nullable(),
  price: yenSchema,
  /** キラフィルムを貼る 1 個あたりの加算額 */
  kiraFilmPrice: yenSchema,
  /** マグネット加工を追加する 1 個あたりの加算額 */
  magnetPrice: yenSchema,
  /** 在庫の残り（総数から、使われている数を引いた数）。0 なら、画面は売り切れにする */
  badgeRemaining: stockSchema,
  /** キラフィルムの在庫の残り。柄ごと。0 の柄は、画面で選べなくする */
  kiraShardsRemaining: stockSchema,
  kiraAuroraRemaining: stockSchema,
  magnetRemaining: stockSchema,
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
  /** キラフィルムを貼る個数（0〜quantity）。省略すると 0。超えていれば db が VALIDATION_FAILED で断る */
  kiraQuantity: z.int().nonnegative().default(0),
  /** キラフィルムの柄。kiraQuantity が 1 以上のとき必須（なければ db が VALIDATION_FAILED で断る） */
  kiraPattern: kiraPatternSchema.optional(),
  /** マグネット加工をする個数（0〜quantity）。省略すると 0。キラフィルムとは独立 */
  magnetQuantity: z.int().nonnegative().default(0),
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
  kiraQuantity: z.int().nonnegative(),
  kiraPattern: kiraPatternSchema.nullable(),
  magnetQuantity: z.int().nonnegative(),
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

// ---- アーカイブ（spec.md 11 章）。公開の可否はスタッフの承認で決まり、承認された作品だけが、他の来場者に見える ----

/** 投稿時の同意（spec.md 11.1）。2 つとも true でなければ、投稿できない（画面でも api でも保証する）。同意の日時は、api が記録する */
export const archiveConsentInputSchema = z.object({
  /** 自作であること */
  selfMade: z.literal(true),
  /** 他の来場者が注文してよいこと */
  allowOthersToOrder: z.literal(true),
});
export type ArchiveConsentInput = z.infer<typeof archiveConsentInputSchema>;

/** 一覧に出す、作品 1 点。作者の匿名トークンは、含めない */
export const archiveEntryViewSchema = z.object({
  id: idSchema,
  displayName: archiveEntrySchema.shape.displayName,
  thumbnailUrl: z.string(),
  createdAt: isoDateTimeSchema,
});
export type ArchiveEntryView = z.infer<typeof archiveEntryViewSchema>;

/** GET /api/archive。公開中の作品を、新しい順に */
export const archiveListQuerySchema = pageQuerySchema;
export const archiveListResponseSchema = pagedSchema(archiveEntryViewSchema);
export type ArchiveListResponse = z.infer<typeof archiveListResponseSchema>;

/** GET /api/archive/:entryId。公開中の作品か、作者本人の作品（どの状態でも） */
export const archiveEntryDetailViewSchema = archiveEntryViewSchema.extend({
  imageUrl: z.string(),
  /** 作品のデザイン。コピーして注文するとき、このまま使う（編集は、まだできない） */
  editorData: editorDataSchema,
  status: archiveStatusSchema,
  /** 自分が投稿した作品か（取り下げの操作を出す） */
  isMine: z.boolean(),
});
export type ArchiveEntryDetailView = z.infer<typeof archiveEntryDetailViewSchema>;

/** GET /api/my/archive・POST /api/archive/:entryId/withdraw。自分が投稿した作品と、いまの状態 */
export const myArchiveEntryViewSchema = archiveEntryViewSchema.extend({
  status: archiveStatusSchema,
});
export type MyArchiveEntryView = z.infer<typeof myArchiveEntryViewSchema>;
export const myArchiveListResponseSchema = z.object({ items: z.array(myArchiveEntryViewSchema) });
export type MyArchiveListResponse = z.infer<typeof myArchiveListResponseSchema>;

/** POST /api/archive。審査待ち（pending_review）で投稿される。アップロードした画像と、エディタのデータを渡す */
export const createArchiveEntryRequestSchema = z.object({
  imageId: idSchema,
  editorData: editorDataSchema,
  displayName: archiveEntrySchema.shape.displayName,
  consent: archiveConsentInputSchema,
});
export type CreateArchiveEntryRequest = z.infer<typeof createArchiveEntryRequestSchema>;
export const createArchiveEntryResponseSchema = z.object({ entryId: idSchema });
export type CreateArchiveEntryResponse = z.infer<typeof createArchiveEntryResponseSchema>;

/** POST /api/archive/:entryId/report */
export const reportArchiveEntryRequestSchema = z.object({
  reason: z.string().trim().min(1).max(500),
});
export type ReportArchiveEntryRequest = z.infer<typeof reportArchiveEntryRequestSchema>;
export const reportArchiveEntryResponseSchema = z.object({ reportId: idSchema });
export type ReportArchiveEntryResponse = z.infer<typeof reportArchiveEntryResponseSchema>;

/** POST /api/archive/:entryId/order。作品をコピーして注文する。受付・上限・Turnstile は、通常の注文と同じ */
export const orderFromArchiveRequestSchema = z.object({
  quantity: quantitySchema,
  kiraQuantity: z.int().nonnegative().default(0),
  /** キラフィルムの柄。kiraQuantity が 1 以上のとき必須 */
  kiraPattern: kiraPatternSchema.optional(),
  /** マグネット加工をする個数（0〜quantity）。省略すると 0。キラフィルムとは独立 */
  magnetQuantity: z.int().nonnegative().default(0),
  turnstileToken: z.string().min(1),
  /** 権利確認への同意（spec.md 11.4）。通常の注文と同じ */
  rightsConsent: z.literal(true),
});
export type OrderFromArchiveRequest = z.infer<typeof orderFromArchiveRequestSchema>;
