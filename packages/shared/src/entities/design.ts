import { z } from "zod";
import { idSchema } from "../ids";
import { isoDateTimeSchema, relativePathSchema } from "../primitives";

/**
 * エディタの編集データ（再編集用の JSON）。中身は packages/editor が決める。
 * 形式を変えても古いデータを読めるよう、version だけをここで必須にする
 */
export const editorDataSchema = z.looseObject({ version: z.int().positive() });
export type EditorData = z.infer<typeof editorDataSchema>;

export const designSchema = z.object({
  id: idSchema,
  /** 印刷用画像の置き場所。データ置き場の images/ 以下の相対パス。DB に画像そのものは入れない */
  imagePath: relativePathSchema,
  editorData: editorDataSchema,
  /** アーカイブ作品をコピーして注文したときの、元の作品（優先度低） */
  sourceArchiveEntryId: idSchema.optional(),
  createdAt: isoDateTimeSchema,
});
export type Design = z.infer<typeof designSchema>;
