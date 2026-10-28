import { z } from "zod";
import {
  anonTokenSchema,
  confirmationCodeSchema,
  idSchema,
  orderIdSchema,
  orderNumberSchema,
} from "../ids";
import { isoDateSchema, isoDateTimeSchema, quantitySchema, yenSchema } from "../primitives";
import { orderItemStatusSchema, orderStatusSchema } from "../status";

/** 注文。明細（items）は含めない。DB の 1 行に対応する形で、画面向けの形は api/ にある */
export const orderSchema = z.object({
  id: orderIdSchema,
  /** 営業開始の操作で決まった日付。注文番号はこの日付の中で一意 */
  businessDate: isoDateSchema,
  orderNumber: orderNumberSchema,
  /** 受け渡しの本人確認と、注文照会に使う */
  confirmationCode: confirmationCodeSchema,
  /** 来場者本人の判定用。画面には返さない */
  anonToken: anonTokenSchema,
  status: orderStatusSchema,
  /** 価格 × 個数 + キラフィルムの加算額 × キラの個数。円の整数 */
  totalAmount: yenSchema,
  createdAt: isoDateTimeSchema,
  paidAt: isoDateTimeSchema.optional(),
  /** 完成した時刻。長時間受け取られていない注文を目立たせるのに使う */
  readyAt: isoDateTimeSchema.optional(),
  pickedUpAt: isoDateTimeSchema.optional(),
  /** 返金は全額のみ。返金額は totalAmount と同じ */
  refundedAt: isoDateTimeSchema.optional(),
});
export type Order = z.infer<typeof orderSchema>;

/** 注文明細。1 つの注文に原則 1 件（デザイン 1 つ・バッジ 1 個） */
export const orderItemSchema = z.object({
  id: idSchema,
  orderId: orderIdSchema,
  designId: idSchema,
  quantity: quantitySchema,
  /** quantity のうち、キラフィルムを貼る個数（0〜quantity）。個数単位で選べる */
  kiraQuantity: z.int().nonnegative(),
  /** quantity のうち、マグネット加工をする個数（0〜quantity）。キラフィルムとは、独立に選べる */
  magnetQuantity: z.int().nonnegative(),
  status: orderItemStatusSchema,
  /** 印刷された回数。1 以上で queued なら再印刷待ちで、次のシートに優先して載る */
  printCount: z.int().nonnegative(),
  /** 印刷待ちに戻った時刻（再印刷など）。印刷を待つ時間の起点。一度も戻っていなければ、ない */
  requeuedAt: isoDateTimeSchema.optional(),
});
export type OrderItem = z.infer<typeof orderItemSchema>;
