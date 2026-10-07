import {
  type Actor,
  type ArchiveEntry,
  type ArchiveStatus,
  anonTokenSchema,
  archiveEntrySchema,
  archiveStatusLabels,
  archiveTransitions,
  type Design,
  type EditorData,
  editorDataSchema,
  type Report,
  type ReportStatus,
  relativePathSchema,
} from "@canbadge/shared";
import { and, count, desc, eq, lt } from "drizzle-orm";
import { z } from "zod";
import { writeAudit } from "./audit";
import type { Database } from "./connection";
import { conflict, DbError, notFound, validationFailed } from "./errors";
import { type Page, toPage } from "./listings";
import { applyOrderTransition } from "./orders";
import { toArchiveEntry, toDesign, toReport } from "./rows";
import { archiveEntries, designs, orderItems, orders, reports } from "./schema";
import { idAt, write } from "./transaction";
import { findTransition } from "./transition";

// アーカイブ（spec.md 11 章）。投稿 → 審査（承認・却下）→ 公開 → 非公開（通報への対応・作者の取り下げ）。
// 状態の変更は、ここの遷移関数だけで行う。遷移表は packages/shared にある。

/** 1 端末が、同時に持てる審査待ちの作品の数。スタッフの審査が、投稿の連打で埋まらないようにする */
export const MAX_PENDING_ENTRIES_PER_AUTHOR = 3;

const createArchiveEntryInputSchema = z.object({
  /** 保存済みの画像（データ置き場の images/ 以下の相対パス）。アップロードの処理は api の担当 */
  imagePath: relativePathSchema,
  editorData: editorDataSchema,
  displayName: archiveEntrySchema.shape.displayName,
  /** 同意の 2 項目。true でなければ投稿できない。日時は、ここで記録する（spec.md 11.1） */
  consent: z.object({ selfMade: z.literal(true), allowOthersToOrder: z.literal(true) }),
  authorAnonToken: anonTokenSchema,
});
export type CreateArchiveEntryInput = z.input<typeof createArchiveEntryInputSchema>;

/** 作品と、そのデザイン（画像のパスと編集データ） */
export type ArchiveItem = { entry: ArchiveEntry; design: Design };

/** 作品を投稿する（審査待ち）。同意が欠けていれば、断る */
export function createArchiveEntry(db: Database, input: CreateArchiveEntryInput): ArchiveItem {
  const parsed = createArchiveEntryInputSchema.safeParse(input);
  if (!parsed.success) {
    throw validationFailed(
      "投稿の内容が正しくありません。同意の項目と、表示名を、確認してください",
      parsed.error.issues,
    );
  }
  const data = parsed.data;

  return write(db, (ctx) => {
    // 同じトランザクションで数えるので、同時に何件も投稿されても、上限を超えない
    const pending = ctx.tx
      .select({ n: count() })
      .from(archiveEntries)
      .where(
        and(
          eq(archiveEntries.authorAnonToken, data.authorAnonToken),
          eq(archiveEntries.status, "pending_review"),
        ),
      )
      .get();
    if ((pending?.n ?? 0) >= MAX_PENDING_ENTRIES_PER_AUTHOR) {
      throw new DbError(
        "RATE_LIMITED",
        `審査待ちの作品が ${MAX_PENDING_ENTRIES_PER_AUTHOR} 件あります。審査が済んでから、投稿してください`,
      );
    }

    const designRow = ctx.tx
      .insert(designs)
      .values({
        id: idAt(ctx),
        imagePath: data.imagePath,
        editorData: data.editorData as EditorData,
        sourceArchiveEntryId: null,
        createdAt: ctx.at,
      })
      .returning()
      .get();
    const entryRow = ctx.tx
      .insert(archiveEntries)
      .values({
        id: idAt(ctx),
        designId: designRow.id,
        displayName: data.displayName,
        status: "pending_review",
        consent: { ...data.consent, agreedAt: ctx.at },
        authorAnonToken: data.authorAnonToken,
        createdAt: ctx.at,
      })
      .returning()
      .get();

    writeAudit(ctx, {
      actor: "visitor",
      action: "archive.create",
      targetType: "archive_entry",
      targetId: entryRow.id,
    });
    return { entry: toArchiveEntry(entryRow), design: toDesign(designRow) };
  });
}

export type ArchiveTransitionInput = {
  entryId: string;
  to: ArchiveStatus;
  actor: Actor;
  /** 来場者（作者）の操作のとき、本人かの照合に使う。作者でなければ、作品があることも教えない（NOT_FOUND） */
  anonToken?: string;
};

/**
 * 作品の状態を変える。表にない遷移・その役割にできない遷移は断る。
 * 非公開（hidden）にしたときは、同じトランザクションで、次の 2 つを行う
 * - その作品をコピーした、支払い前（submitted）の注文を止める（失効。操作ログに理由を残す）
 * - その作品への、未対応の通報を、対応済みにする（作品を非公開にしたことが、対応になるため）
 */
export function transitionArchiveEntry(db: Database, input: ArchiveTransitionInput): ArchiveItem {
  return write(db, (ctx) => {
    const row = ctx.tx
      .select()
      .from(archiveEntries)
      .where(eq(archiveEntries.id, input.entryId))
      .get();
    if (!row) throw notFound("作品");
    if (input.actor === "visitor" && row.authorAnonToken !== input.anonToken)
      throw notFound("作品");
    const entry = toArchiveEntry(row);

    findTransition(archiveTransitions, archiveStatusLabels, {
      from: entry.status,
      to: input.to,
      actor: input.actor,
    });

    // 更新できた行がなければ、読んだあとに別の操作で状態が変わった（競合）
    const updated = ctx.tx
      .update(archiveEntries)
      .set({
        status: input.to,
        // 審査した日時。作者の取り下げは、審査ではないので、入れない
        ...(input.actor === "staff" ? { reviewedAt: ctx.at } : {}),
      })
      .where(and(eq(archiveEntries.id, entry.id), eq(archiveEntries.status, entry.status)))
      .returning()
      .all();
    if (updated.length === 0) throw conflict("作品");

    let expiredOrders = 0;
    let resolvedReports = 0;
    if (input.to === "hidden") {
      const pendingOrders = ctx.tx
        .selectDistinct({ id: orders.id })
        .from(orders)
        .innerJoin(orderItems, eq(orderItems.orderId, orders.id))
        .innerJoin(designs, eq(designs.id, orderItems.designId))
        .where(and(eq(designs.sourceArchiveEntryId, entry.id), eq(orders.status, "submitted")))
        .all();
      for (const { id } of pendingOrders) {
        applyOrderTransition(ctx, {
          orderId: id,
          to: "expired",
          actor: "system",
          detail: { reason: "archive_hidden", archiveEntryId: entry.id },
        });
      }
      expiredOrders = pendingOrders.length;
      resolvedReports = ctx.tx
        .update(reports)
        .set({ status: "resolved", resolvedAt: ctx.at })
        .where(and(eq(reports.archiveEntryId, entry.id), eq(reports.status, "open")))
        .returning({ id: reports.id })
        .all().length;
    }

    writeAudit(ctx, {
      actor: input.actor,
      action: "archive.transition",
      targetType: "archive_entry",
      targetId: entry.id,
      detail: { from: entry.status, to: input.to, expiredOrders, resolvedReports },
    });
    const item = readItem(ctx.tx, entry.id);
    if (!item) throw notFound("作品");
    return item;
  });
}

/** 公開中の作品を通報する。公開中でない作品は、見えないので、通報もできない（NOT_FOUND） */
export function createReport(db: Database, input: { entryId: string; reason: string }): Report {
  const reason = z.string().trim().min(1).max(500).safeParse(input.reason);
  if (!reason.success) throw validationFailed("通報の理由を、500 文字までで、入れてください");

  return write(db, (ctx) => {
    const entry = ctx.tx
      .select()
      .from(archiveEntries)
      .where(eq(archiveEntries.id, input.entryId))
      .get();
    if (entry?.status !== "public") throw notFound("作品");
    const row = ctx.tx
      .insert(reports)
      .values({
        id: idAt(ctx),
        archiveEntryId: entry.id,
        reason: reason.data,
        status: "open",
        createdAt: ctx.at,
      })
      .returning()
      .get();
    writeAudit(ctx, {
      actor: "visitor",
      action: "report.create",
      targetType: "report",
      targetId: row.id,
      detail: { archiveEntryId: entry.id },
    });
    return toReport(row);
  });
}

/** 通報を、対応済みにする（スタッフ）。すでに対応済みなら、断る */
export function resolveReport(db: Database, input: { reportId: string }): Report {
  return write(db, (ctx) => {
    const row = ctx.tx.select().from(reports).where(eq(reports.id, input.reportId)).get();
    if (!row) throw notFound("通報");
    if (row.status !== "open") {
      throw new DbError("INVALID_TRANSITION", "この通報は、すでに対応済みです");
    }
    const updated = ctx.tx
      .update(reports)
      .set({ status: "resolved", resolvedAt: ctx.at })
      .where(and(eq(reports.id, row.id), eq(reports.status, "open")))
      .returning()
      .all();
    if (updated.length === 0) throw conflict("通報");
    writeAudit(ctx, {
      actor: "staff",
      action: "report.resolve",
      targetType: "report",
      targetId: row.id,
      detail: { archiveEntryId: row.archiveEntryId },
    });
    return toReport(updated[0] ?? row);
  });
}

// ---- 読み取り ----

type Reader = Pick<Database["orm"], "select">;

function readItem(reader: Reader, entryId: string): ArchiveItem | undefined {
  const row = reader
    .select({ entry: archiveEntries, design: designs })
    .from(archiveEntries)
    .innerJoin(designs, eq(designs.id, archiveEntries.designId))
    .where(eq(archiveEntries.id, entryId))
    .get();
  return row ? { entry: toArchiveEntry(row.entry), design: toDesign(row.design) } : undefined;
}

/** 作品とデザイン。なければ undefined（公開かどうかは、呼び出し側が見る） */
export function getArchiveItem(db: Database, entryId: string): ArchiveItem | undefined {
  return readItem(db.orm, entryId);
}

/** 公開中の作品（新しい順） */
export function listPublicArchive(
  db: Database,
  input: { before?: string; limit: number },
): Page<ArchiveItem> {
  const rows = db.orm
    .select({ entry: archiveEntries, design: designs })
    .from(archiveEntries)
    .innerJoin(designs, eq(designs.id, archiveEntries.designId))
    .where(
      and(
        eq(archiveEntries.status, "public"),
        input.before ? lt(archiveEntries.id, input.before) : undefined,
      ),
    )
    .orderBy(desc(archiveEntries.id))
    .limit(input.limit + 1)
    .all()
    .map((r) => ({ entry: toArchiveEntry(r.entry), design: toDesign(r.design) }));
  return toPage(rows, input.limit, (item) => item.entry.id);
}

/** 自分（匿名トークン）が投稿した作品。どの状態でも、新しい順 */
export function listArchiveByAuthor(db: Database, anonToken: string): ArchiveItem[] {
  return db.orm
    .select({ entry: archiveEntries, design: designs })
    .from(archiveEntries)
    .innerJoin(designs, eq(designs.id, archiveEntries.designId))
    .where(eq(archiveEntries.authorAnonToken, anonToken))
    .orderBy(desc(archiveEntries.id))
    .all()
    .map((r) => ({ entry: toArchiveEntry(r.entry), design: toDesign(r.design) }));
}

export type StaffArchiveItem = ArchiveItem & { openReportCount: number };

/** 審査の一覧（新しい順）。未対応の通報の件数つき */
export function listStaffArchive(
  db: Database,
  input: { status?: ArchiveStatus; before?: string; limit: number },
): Page<StaffArchiveItem> {
  const rows = db.orm
    .select({ entry: archiveEntries, design: designs })
    .from(archiveEntries)
    .innerJoin(designs, eq(designs.id, archiveEntries.designId))
    .where(
      and(
        input.status ? eq(archiveEntries.status, input.status) : undefined,
        input.before ? lt(archiveEntries.id, input.before) : undefined,
      ),
    )
    .orderBy(desc(archiveEntries.id))
    .limit(input.limit + 1)
    .all();

  const openCounts = new Map<string, number>();
  for (const { entry } of rows) {
    const row = db.orm
      .select({ n: count() })
      .from(reports)
      .where(and(eq(reports.archiveEntryId, entry.id), eq(reports.status, "open")))
      .get();
    openCounts.set(entry.id, row?.n ?? 0);
  }
  const items = rows.map((r) => ({
    entry: toArchiveEntry(r.entry),
    design: toDesign(r.design),
    openReportCount: openCounts.get(r.entry.id) ?? 0,
  }));
  return toPage(items, input.limit, (item) => item.entry.id);
}

export type ReportItem = { report: Report; entry: ArchiveEntry; design: Design };

/** 通報の一覧（新しい順）。通報された作品つき */
export function listReports(
  db: Database,
  input: { status?: ReportStatus; before?: string; limit: number },
): Page<ReportItem> {
  const rows = db.orm
    .select({ report: reports, entry: archiveEntries, design: designs })
    .from(reports)
    .innerJoin(archiveEntries, eq(archiveEntries.id, reports.archiveEntryId))
    .innerJoin(designs, eq(designs.id, archiveEntries.designId))
    .where(
      and(
        input.status ? eq(reports.status, input.status) : undefined,
        input.before ? lt(reports.id, input.before) : undefined,
      ),
    )
    .orderBy(desc(reports.id))
    .limit(input.limit + 1)
    .all()
    .map((r) => ({
      report: toReport(r.report),
      entry: toArchiveEntry(r.entry),
      design: toDesign(r.design),
    }));
  return toPage(rows, input.limit, (item) => item.report.id);
}

/** 通報 1 件と、その作品。なければ undefined */
export function getReportItem(db: Database, reportId: string): ReportItem | undefined {
  const r = db.orm
    .select({ report: reports, entry: archiveEntries, design: designs })
    .from(reports)
    .innerJoin(archiveEntries, eq(archiveEntries.id, reports.archiveEntryId))
    .innerJoin(designs, eq(designs.id, archiveEntries.designId))
    .where(eq(reports.id, reportId))
    .get();
  return r
    ? { report: toReport(r.report), entry: toArchiveEntry(r.entry), design: toDesign(r.design) }
    : undefined;
}
