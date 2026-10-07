import { z } from "zod";
import { idSchema } from "../ids";

/** 一覧の取得件数。クエリ文字列は文字なので coerce で数値にする */
export const limitSchema = z.coerce.number().int().min(1).max(100).default(30);

/** 新しい順の一覧で、続きを取るときの目印。api が返した nextBefore をそのまま渡す */
export const beforeSchema = z.string().min(1).max(200).optional();

export const pageQuerySchema = z.object({ before: beforeSchema, limit: limitSchema });
export type PageQuery = z.infer<typeof pageQuerySchema>;

/** 一覧の返し方。nextBefore が null なら、これ以上ない */
export function pagedSchema<T extends z.ZodType>(item: T) {
  return z.object({ items: z.array(item), nextBefore: z.string().nullable() });
}

/** パスの :orderId など。ULID */
export const orderIdParamsSchema = z.object({ orderId: idSchema });
export const sheetIdParamsSchema = z.object({ sheetId: idSchema });
export const imageIdParamsSchema = z.object({ imageId: idSchema });
export const archiveEntryIdParamsSchema = z.object({ entryId: idSchema });
export const reportIdParamsSchema = z.object({ reportId: idSchema });
