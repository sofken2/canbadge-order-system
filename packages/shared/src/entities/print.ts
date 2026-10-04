import { z } from "zod";
import { idSchema } from "../ids";
import { isoDateTimeSchema, relativePathSchema } from "../primitives";
import { printSheetStatusSchema, printSlotResultSchema } from "../status";

/** 印刷した用紙 1 枚 */
export const printSheetSchema = z.object({
  id: idSchema,
  /** 生成した PDF の置き場所。データ置き場の sheets/ 以下の相対パス */
  pdfPath: relativePathSchema,
  status: printSheetStatusSchema,
  printedAt: isoDateTimeSchema,
  /** 印刷係が確認を済ませた時刻 */
  checkedAt: isoDateTimeSchema.optional(),
});
export type PrintSheet = z.infer<typeof printSheetSchema>;

/** シート上のバッジ 1 個 = 1 行。印刷の履歴はこの表にすべて残し、削除しない */
export const printSlotSchema = z.object({
  sheetId: idSchema,
  /** PDF 上の並び順（0 始まり）。画面は、この順に注文番号を並べて用紙と照合しやすくする */
  position: z.int().nonnegative(),
  orderItemId: idSchema,
  result: printSlotResultSchema,
});
export type PrintSlot = z.infer<typeof printSlotSchema>;
