import { z } from "zod";
import { archiveEntrySchema, reportSchema } from "../entities/archive";
import { settingSchema } from "../entities/setting";
import { confirmationCodeInputSchema, idSchema, orderIdSchema, orderNumberSchema } from "../ids";
import { isoDateSchema, isoDateTimeSchema, quantitySchema, yenSchema } from "../primitives";
import {
  acceptanceSchema,
  archiveStatusSchema,
  orderItemStatusSchema,
  orderStatusSchema,
  printSheetStatusSchema,
  printSlotResultSchema,
  reportStatusSchema,
} from "../status";
import { beforeSchema, limitSchema, pagedSchema } from "./common";

// スタッフ向け（/api/staff/*）。Cloudflare Access などで認証済みのリクエストだけが通る。

/**
 * スタッフ画面に返す注文。確認コードは含めない。
 * 受け渡しでは、来場者に聞いたコードを pickup に送り、api が照合する（画面に正解を持たせない）
 */
export const staffOrderViewSchema = z.object({
  id: orderIdSchema,
  businessDate: isoDateSchema,
  orderNumber: orderNumberSchema,
  orderNumberText: z.string(),
  status: orderStatusSchema,
  totalAmount: yenSchema,
  createdAt: isoDateTimeSchema,
  paidAt: isoDateTimeSchema.optional(),
  readyAt: isoDateTimeSchema.optional(),
  pickedUpAt: isoDateTimeSchema.optional(),
  refundedAt: isoDateTimeSchema.optional(),
  items: z.array(
    z.object({
      id: idSchema,
      quantity: quantitySchema,
      /** うち、キラフィルムを貼る個数。組み立てで貼り忘れないよう見せる */
      kiraQuantity: z.int().nonnegative(),
      magnetQuantity: z.int().nonnegative(),
      status: orderItemStatusSchema,
      printCount: z.int().nonnegative(),
      thumbnailUrl: z.string(),
    }),
  ),
});
export type StaffOrderView = z.infer<typeof staffOrderViewSchema>;

const orderStatusListSchema = z
  .string()
  .transform((value) => value.split(",").filter((part) => part.length > 0))
  .pipe(z.array(orderStatusSchema));

/** GET /api/staff/orders。q は、QR の中身（注文 ID）か、当日の注文番号 */
export const staffOrderSearchQuerySchema = z.object({
  q: z.string().trim().min(1).max(40).optional(),
  /** カンマ区切り（例: printed,assembling,ready） */
  status: orderStatusListSchema.optional(),
  before: beforeSchema,
  limit: limitSchema,
});
export type StaffOrderSearchQuery = z.infer<typeof staffOrderSearchQuerySchema>;

export const staffOrderListResponseSchema = pagedSchema(staffOrderViewSchema);
export type StaffOrderListResponse = z.infer<typeof staffOrderListResponseSchema>;

/** POST /api/staff/orders/:orderId/pickup。照合は api が行い、違えば CONFIRMATION_MISMATCH */
export const pickupRequestSchema = z.object({ confirmationCode: confirmationCodeInputSchema });
export type PickupRequest = z.infer<typeof pickupRequestSchema>;

/** 印刷シートに載っているバッジ 1 個。position 順が PDF 上の並び順 */
export const printSlotViewSchema = z.object({
  position: z.int().nonnegative(),
  orderItemId: idSchema,
  orderId: orderIdSchema,
  orderNumber: orderNumberSchema,
  orderNumberText: z.string(),
  orderStatus: orderStatusSchema,
  thumbnailUrl: z.string(),
  result: printSlotResultSchema,
});
export type PrintSlotView = z.infer<typeof printSlotViewSchema>;

export const printSheetViewSchema = z.object({
  id: idSchema,
  status: printSheetStatusSchema,
  printedAt: isoDateTimeSchema,
  checkedAt: isoDateTimeSchema.optional(),
  slots: z.array(printSlotViewSchema),
});
export type PrintSheetView = z.infer<typeof printSheetViewSchema>;

/** GET /api/staff/print-sheets/current。印刷中のシートがなければ sheet が null */
export const currentPrintSheetResponseSchema = z.object({ sheet: printSheetViewSchema.nullable() });
export type CurrentPrintSheetResponse = z.infer<typeof currentPrintSheetResponseSchema>;

/** GET /api/staff/print-sheets。印刷ジョブの履歴（新しい順） */
export const printSheetListResponseSchema = pagedSchema(printSheetViewSchema);
export type PrintSheetListResponse = z.infer<typeof printSheetListResponseSchema>;

/** 印刷済みのバッジ 1 個。履歴の一覧から選んで再印刷する */
export const printedItemViewSchema = z.object({
  orderItemId: idSchema,
  orderId: orderIdSchema,
  orderNumber: orderNumberSchema,
  orderNumberText: z.string(),
  orderStatus: orderStatusSchema,
  status: orderItemStatusSchema,
  printCount: z.int().nonnegative(),
  lastPrintedAt: isoDateTimeSchema,
  thumbnailUrl: z.string(),
  /** 再印刷できるか。受け渡し済み・取り消し・失効・返金済みの注文や、印刷待ち・印刷中のバッジは false */
  reprintable: z.boolean(),
});
export type PrintedItemView = z.infer<typeof printedItemViewSchema>;

/** GET /api/staff/printed-items。q は注文番号 */
export const printedItemsQuerySchema = z.object({
  q: z.string().trim().min(1).max(40).optional(),
  before: beforeSchema,
  limit: limitSchema,
});
export type PrintedItemsQuery = z.infer<typeof printedItemsQuerySchema>;

export const printedItemListResponseSchema = pagedSchema(printedItemViewSchema);
export type PrintedItemListResponse = z.infer<typeof printedItemListResponseSchema>;

/** POST /api/staff/reprints。バッジ一覧からも、シートからも、同じ形で呼ぶ */
export const reprintRequestSchema = z.object({
  orderItemIds: z.array(idSchema).min(1).max(100),
});
export type ReprintRequest = z.infer<typeof reprintRequestSchema>;

/**
 * 再印刷の結果。すでに queued のバッジは何もせず skipped に入れる。
 * 再印刷できない注文のバッジが 1 つでもあれば、全体を INVALID_TRANSITION で断る（一部だけ実行しない）
 */
export const reprintResponseSchema = z.object({
  reprintedItemIds: z.array(idSchema),
  skippedItemIds: z.array(idSchema),
});
export type ReprintResponse = z.infer<typeof reprintResponseSchema>;

/** POST /api/staff/print-queue/{pause,resume} の応答 */
export const printQueueStateResponseSchema = z.object({ printPaused: z.boolean() });
export type PrintQueueStateResponse = z.infer<typeof printQueueStateResponseSchema>;

/** POST /api/staff/acceptance。busyMessage は busy のときの案内文（省略すると既定の文言） */
export const setAcceptanceRequestSchema = z.object({
  acceptance: acceptanceSchema,
  busyMessage: z.string().trim().max(100).nullable().optional(),
});
export type SetAcceptanceRequest = z.infer<typeof setAcceptanceRequestSchema>;

/**
 * PUT /api/staff/settings。画面で編集する項目を、すべて送って置き換える。
 * 営業日・受付状態・印刷の一時停止は、専用の API（business-day・acceptance・print-queue）で変える
 */
export const updateSettingRequestSchema = settingSchema.pick({
  price: true,
  kiraFilmPrice: true,
  magnetPrice: true,
  badgeStock: true,
  kiraFilmStock: true,
  magnetStock: true,
  maxQuantityPerOrder: true,
  maxPendingPerDevice: true,
  printMaxWaitSeconds: true,
  orderNumberDigits: true,
  imageMaxBytes: true,
});
export type UpdateSettingRequest = z.infer<typeof updateSettingRequestSchema>;

/** GET /api/staff/sales。businessDate を省略すると現在の営業日 */
export const salesQuerySchema = z.object({ businessDate: isoDateSchema.optional() });
export type SalesQuery = z.infer<typeof salesQuerySchema>;

export const salesResponseSchema = z.object({
  businessDate: isoDateSchema,
  /** 支払った時刻（paidAt、日本時間）の時間帯ごと。注文のなかった時間帯は含めない */
  hourly: z.array(
    z.object({
      hour: z.int().min(0).max(23),
      paidCount: z.int().nonnegative(),
      paidAmount: yenSchema,
    }),
  ),
  /** レジの現金と照合する。返金（全額のみ）を差し引いた額が netAmount */
  total: z.object({
    paidCount: z.int().nonnegative(),
    paidAmount: yenSchema,
    refundedCount: z.int().nonnegative(),
    refundedAmount: yenSchema,
    netAmount: yenSchema,
  }),
});
export type SalesResponse = z.infer<typeof salesResponseSchema>;

// ---- アーカイブの審査（S06） ----

/** GET /api/staff/archive。status を指定しなければ、すべての状態 */
export const staffArchiveQuerySchema = z.object({
  status: archiveStatusSchema.optional(),
  before: beforeSchema,
  limit: limitSchema,
});
export type StaffArchiveQuery = z.infer<typeof staffArchiveQuerySchema>;

/** 審査の一覧の 1 点。権利面の確認のため、大きい画像（imageUrl）も返す */
export const staffArchiveEntryViewSchema = z.object({
  id: idSchema,
  displayName: archiveEntrySchema.shape.displayName,
  status: archiveStatusSchema,
  thumbnailUrl: z.string(),
  imageUrl: z.string(),
  createdAt: isoDateTimeSchema,
  reviewedAt: isoDateTimeSchema.optional(),
  /** 未対応（open）の通報の数 */
  openReportCount: z.int().nonnegative(),
});
export type StaffArchiveEntryView = z.infer<typeof staffArchiveEntryViewSchema>;
export const staffArchiveListResponseSchema = pagedSchema(staffArchiveEntryViewSchema);
export type StaffArchiveListResponse = z.infer<typeof staffArchiveListResponseSchema>;

/** GET /api/staff/archive/reports。status を指定しなければ、すべて */
export const reportListQuerySchema = z.object({
  status: reportStatusSchema.optional(),
  before: beforeSchema,
  limit: limitSchema,
});
export type ReportListQuery = z.infer<typeof reportListQuerySchema>;

/** 通報 1 件。通報された作品の概要つき */
export const reportViewSchema = reportSchema.extend({
  entry: z.object({
    displayName: archiveEntrySchema.shape.displayName,
    status: archiveStatusSchema,
    thumbnailUrl: z.string(),
    imageUrl: z.string(),
  }),
});
export type ReportView = z.infer<typeof reportViewSchema>;
export const reportListResponseSchema = pagedSchema(reportViewSchema);
export type ReportListResponse = z.infer<typeof reportListResponseSchema>;
