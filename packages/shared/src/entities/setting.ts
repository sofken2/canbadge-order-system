import { z } from "zod";
import { isoDateSchema, isoDateTimeSchema, quantitySchema, yenSchema } from "../primitives";
import { acceptanceSchema } from "../status";

/**
 * 設定。1 行だけのテーブルで、当日に画面から変える値を持つ。
 * 寸法のように当日は変えない値は packages/badge-spec にあり、ここには置かない
 */
export const settingSchema = z.object({
  /** 営業開始の操作で設定される。営業開始前は null */
  businessDate: isoDateSchema.nullable(),
  acceptance: acceptanceSchema,
  /** busy のとき、来場者に見せる案内文 */
  busyMessage: z.string().max(100).nullable(),
  /** 1 個あたりの価格（円） */
  price: yenSchema,
  /** 1 注文あたりの個数の上限。原則 1。1 のとき画面は個数の選択を出さない */
  maxQuantityPerOrder: quantitySchema,
  /** 1 端末あたりの、支払い待ち注文の上限 */
  maxPendingPerDevice: quantitySchema,
  /** 用紙 1 枚分たまらなくても、最も古い明細がこの秒数待ったら印刷する */
  printMaxWaitSeconds: quantitySchema,
  printPaused: z.boolean(),
  /** 注文番号の表示桁数（ゼロ埋め） */
  orderNumberDigits: z.int().min(1).max(6),
  /** アップロード画像の容量上限（バイト） */
  imageMaxBytes: quantitySchema,
  updatedAt: isoDateTimeSchema,
});
export type Setting = z.infer<typeof settingSchema>;
