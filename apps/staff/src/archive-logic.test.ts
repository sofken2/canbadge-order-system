import { describe, expect, test } from "bun:test";
import type { ReportView, StaffArchiveEntryView } from "@canbadge/shared";
import {
  archiveTabLabels,
  countOpenReports,
  hideConfirmMessage,
  isLongPending,
  LONG_PENDING_MINUTES,
  orderForReview,
  reportHeadline,
  tabStatuses,
  waitedLabel,
} from "./archive-logic";

const ID = "01HZX3V5Q8N4M6T2B9C7D1E0FA";
const NOW = Date.parse("2026-11-03T10:00:00.000Z");

const entry = (overrides: Partial<StaffArchiveEntryView> = {}): StaffArchiveEntryView => ({
  id: ID,
  displayName: "たろう",
  status: "pending_review",
  thumbnailUrl: "/t",
  imageUrl: "/i",
  createdAt: "2026-11-03T09:50:00.000Z",
  openReportCount: 0,
  ...overrides,
});

describe("タブと状態", () => {
  test("審査待ち・公開中・却下と非公開は、作品の状態で読む。通報は、別の一覧", () => {
    expect(tabStatuses.pending).toEqual(["pending_review"]);
    expect(tabStatuses.public).toEqual(["public"]);
    expect(tabStatuses.closed).toEqual(["rejected", "hidden"]);
    expect(Object.keys(archiveTabLabels)).toEqual(["pending", "public", "reports", "closed"]);
  });
});

describe("並び順", () => {
  const items = [
    { id: "c", createdAt: "3" },
    { id: "b", createdAt: "2" },
    { id: "a", createdAt: "1" },
  ];
  test("審査待ちは、古いものから。ほかは、新しい順のまま。元の配列は変えない", () => {
    expect(orderForReview("pending", items).map((i) => i.id)).toEqual(["a", "b", "c"]);
    expect(orderForReview("public", items).map((i) => i.id)).toEqual(["c", "b", "a"]);
    expect(orderForReview("closed", items).map((i) => i.id)).toEqual(["c", "b", "a"]);
    expect(items.map((i) => i.id)).toEqual(["c", "b", "a"]);
  });
});

describe("待ち時間", () => {
  test("経過を、読みやすく。0 分はたったいま。読めない時刻は、空", () => {
    expect(waitedLabel("2026-11-03T10:00:00.000Z", NOW)).toBe("たったいま");
    expect(waitedLabel("2026-11-03T09:57:00.000Z", NOW)).toBe("3 分前");
    expect(waitedLabel("2026-11-03T08:55:00.000Z", NOW)).toBe("1 時間 5 分前");
    expect(waitedLabel(undefined, NOW)).toBe("");
    expect(waitedLabel("ふつうの文字", NOW)).toBe("");
  });

  test("審査待ちが 30 分を超えたら、長く待たせている。公開中などは、対象外", () => {
    expect(LONG_PENDING_MINUTES).toBe(30);
    expect(isLongPending(entry({ createdAt: "2026-11-03T09:31:00.000Z" }), NOW)).toBe(false);
    expect(isLongPending(entry({ createdAt: "2026-11-03T09:30:00.000Z" }), NOW)).toBe(true);
    expect(
      isLongPending(entry({ status: "public", createdAt: "2026-11-03T01:00:00.000Z" }), NOW),
    ).toBe(false);
  });
});

describe("文", () => {
  test("非公開の確認は、何が起きるかを、具体的に書く（注文が止まる・支払い済みはそのまま・通報が対応済みになる）", () => {
    const text = hideConfirmMessage("たろう");
    expect(text).toContain("「たろう」さん");
    expect(text).toContain("まだ支払っていない注文は、止まります");
    expect(text).toContain("支払い済みの注文は、そのままです");
    expect(text).toContain("対応済み");
  });

  test("通報の見出しに、作品の表示名が入る", () => {
    const report = {
      id: ID,
      archiveEntryId: ID,
      reason: "x",
      status: "open",
      createdAt: "2026-11-03T09:50:00.000Z",
      entry: { displayName: "はなこ", status: "public", thumbnailUrl: "/t", imageUrl: "/i" },
    } satisfies ReportView;
    expect(reportHeadline(report)).toBe("「はなこ」さんの作品への通報");
    expect(countOpenReports([report, { ...report, status: "resolved" }])).toBe(1);
  });
});
