import {
  type ArchiveItem,
  createArchiveEntry,
  createReport,
  getArchiveItem,
  getReportItem,
  listArchiveByAuthor,
  listPublicArchive,
  listReports,
  listStaffArchive,
  resolveReport,
  transitionArchiveEntry,
} from "@canbadge/db";
import type { Context } from "hono";
import { enforce, visitorIp } from "../abuse";
import { ensureAnonToken, readAnonToken } from "../anon";
import type { Deps } from "../deps";
import { notFound, validationFailed } from "../errors";
import { findImage } from "../images";
import { placeOrder } from "../order-flow";
import type { HandlersFor } from "../register";
import {
  archiveEntryDetailView,
  archiveEntryView,
  myArchiveEntryView,
  reportView,
  staffArchiveEntryView,
  staffArchiveListItemView,
} from "../views";

// アーカイブ（spec.md 11 章）。来場者向けは認証なしで、作者の判定は匿名トークンの Cookie。
// 状態の変更は、packages/db の遷移関数だけで行う（承認・却下・非公開・取り下げ）。

export const archiveHandlers: HandlersFor<
  | "listArchive"
  | "getArchiveEntry"
  | "listMyArchive"
  | "createArchiveEntry"
  | "withdrawArchiveEntry"
  | "reportArchiveEntry"
  | "orderFromArchive"
  | "listStaffArchive"
  | "approveArchiveEntry"
  | "rejectArchiveEntry"
  | "hideArchiveEntry"
  | "listArchiveReports"
  | "resolveArchiveReport"
> = {
  // ---- 来場者向け ----
  listArchive: ({ deps, query }) => {
    const page = listPublicArchive(deps.db, { before: query.before, limit: query.limit });
    return { items: page.items.map(archiveEntryView), nextBefore: page.nextBefore };
  },

  getArchiveEntry: ({ c, deps, params }) => {
    const item = getArchiveItem(deps.db, params.entryId);
    const token = readAnonToken(c);
    const isMine = !!item && !!token && item.entry.authorAnonToken === token;
    // 公開中の作品か、作者本人の作品だけ。それ以外は、あることも教えない
    if (!item || (item.entry.status !== "public" && !isMine)) throw notFound("作品");
    return archiveEntryDetailView(item, isMine);
  },

  listMyArchive: ({ c, deps }) => {
    const token = readAnonToken(c);
    return { items: token ? listArchiveByAuthor(deps.db, token).map(myArchiveEntryView) : [] };
  },

  createArchiveEntry: ({ c, deps, body }) => {
    enforceArchiveLimit(c, deps, "投稿");
    const image = findImage(deps.dataDir, body.imageId);
    if (!image) throw validationFailed("画像が見つかりません。もう一度アップロードしてください");
    // 同意の 2 項目は、契約のスキーマ（true のみ）と、db の検証の両方で、保証される
    const { entry } = createArchiveEntry(deps.db, {
      imagePath: `images/${body.imageId}.${image.extension}`,
      editorData: body.editorData,
      displayName: body.displayName,
      consent: body.consent,
      authorAnonToken: ensureAnonToken(c),
    });
    return { entryId: entry.id };
  },

  withdrawArchiveEntry: ({ c, deps, params }) => {
    const item = transitionArchiveEntry(deps.db, {
      entryId: params.entryId,
      to: "hidden",
      actor: "visitor",
      // 作者でなければ、db が NOT_FOUND にする
      anonToken: readAnonToken(c) ?? "",
    });
    return myArchiveEntryView(item);
  },

  reportArchiveEntry: ({ c, deps, params, body }) => {
    enforceArchiveLimit(c, deps, "通報");
    const report = createReport(deps.db, { entryId: params.entryId, reason: body.reason });
    return { reportId: report.id };
  },

  orderFromArchive: ({ c, deps, params, body }) =>
    // 受付・上限・Turnstile・回数の制限は、通常の注文と共通（order-flow.ts）
    placeOrder(c, deps, body, () => {
      const item = getArchiveItem(deps.db, params.entryId);
      if (item?.entry.status !== "public") throw notFound("作品");
      return {
        imagePath: item.design.imagePath,
        editorData: item.design.editorData,
        sourceArchiveEntryId: item.entry.id,
      };
    }),

  // ---- スタッフ向け ----
  listStaffArchive: ({ deps, query }) => {
    const page = listStaffArchive(deps.db, {
      status: query.status,
      before: query.before,
      limit: query.limit,
    });
    return { items: page.items.map(staffArchiveListItemView), nextBefore: page.nextBefore };
  },

  approveArchiveEntry: ({ deps, params }) => reviewed(deps, params.entryId, "public"),
  rejectArchiveEntry: ({ deps, params }) => reviewed(deps, params.entryId, "rejected"),
  hideArchiveEntry: ({ deps, params }) => reviewed(deps, params.entryId, "hidden"),

  listArchiveReports: ({ deps, query }) => {
    const page = listReports(deps.db, {
      status: query.status,
      before: query.before,
      limit: query.limit,
    });
    return { items: page.items.map(reportView), nextBefore: page.nextBefore };
  },

  resolveArchiveReport: ({ deps, params }) => {
    resolveReport(deps.db, { reportId: params.reportId });
    const item = getReportItem(deps.db, params.reportId);
    if (!item) throw notFound("通報");
    return reportView(item);
  },
};

/** スタッフの審査。変更のあとの作品を、未対応の通報の件数つきで返す */
function reviewed(deps: Deps, entryId: string, to: "public" | "rejected" | "hidden") {
  const item: ArchiveItem = transitionArchiveEntry(deps.db, { entryId, to, actor: "staff" });
  const open = listStaffArchive(deps.db, { limit: 100 }).items.find(
    (i) => i.entry.id === item.entry.id,
  );
  return staffArchiveEntryView(item, open?.openReportCount ?? 0);
}

/** 投稿・通報の回数の制限（画像のアップロードと同じ枠）。連打で、審査・通報の一覧が埋まらないようにする */
function enforceArchiveLimit(c: Context, deps: Deps, what: string): void {
  enforce(
    deps.abuse.uploads,
    visitorIp(c, deps.remoteAddressOf?.(c)),
    (wait) =>
      `${what}を、短い間に、たくさん行っています。${wait}ほど待ってから、もう一度お試しください`,
  );
}
