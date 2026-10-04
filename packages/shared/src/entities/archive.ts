import { z } from "zod";
import { anonTokenSchema, idSchema } from "../ids";
import { isoDateTimeSchema } from "../primitives";
import { archiveStatusSchema, reportStatusSchema } from "../status";

// アーカイブは優先度低（API・画面は A04・W05〜W07・S06）。
// データ構造だけをここで定義し、DB とサンプルデータ（T05・T06）が後で契約を変えずに済むようにする

/** 投稿時の同意。内容と日時を記録する（spec.md 11.1） */
export const archiveConsentSchema = z.object({
  /** 自作であること */
  selfMade: z.literal(true),
  /** 他の来場者が注文してよいこと */
  allowOthersToOrder: z.literal(true),
  agreedAt: isoDateTimeSchema,
});
export type ArchiveConsent = z.infer<typeof archiveConsentSchema>;

export const archiveEntrySchema = z.object({
  id: idSchema,
  designId: idSchema,
  /** 任意のニックネーム */
  displayName: z.string().trim().min(1).max(20),
  status: archiveStatusSchema,
  consent: archiveConsentSchema,
  /** 投稿した端末の匿名トークン。作者本人の判定に使い、画面には返さない */
  authorAnonToken: anonTokenSchema,
  createdAt: isoDateTimeSchema,
  reviewedAt: isoDateTimeSchema.optional(),
});
export type ArchiveEntry = z.infer<typeof archiveEntrySchema>;

export const reportSchema = z.object({
  id: idSchema,
  archiveEntryId: idSchema,
  reason: z.string().trim().min(1).max(500),
  status: reportStatusSchema,
  createdAt: isoDateTimeSchema,
  resolvedAt: isoDateTimeSchema.optional(),
});
export type Report = z.infer<typeof reportSchema>;
