import { describe, expect, test } from "bun:test";
import type { ArchiveEntryView } from "@canbadge/shared";
import {
  appendPage,
  authorLine,
  orderBlockedReason,
  REPORT_REASON_MAX,
  reportProblem,
} from "./archive-view-logic";

const entry = (id: string): ArchiveEntryView => ({
  id,
  displayName: "たろう",
  thumbnailUrl: `/api/images/${id}?size=thumb`,
  createdAt: "2026-11-03T00:00:00.000Z",
});

describe("一覧のページ送り", () => {
  test("続きのページを、後ろに足す", () => {
    expect(appendPage([entry("a"), entry("b")], [entry("c")]).map((e) => e.id)).toEqual([
      "a",
      "b",
      "c",
    ]);
  });

  test("ページの境目で、同じ作品が 2 回出ない（読み込み中に、新しい作品が公開されたとき）", () => {
    expect(appendPage([entry("a"), entry("b")], [entry("b"), entry("c")]).map((e) => e.id)).toEqual(
      ["a", "b", "c"],
    );
  });

  test("空の一覧・空の続きでも、壊れない。元の配列は変えない", () => {
    const current = [entry("a")];
    expect(appendPage([], [entry("a")])).toHaveLength(1);
    expect(appendPage(current, [])).toEqual(current);
    appendPage(current, [entry("b")]);
    expect(current).toHaveLength(1);
  });
});

describe("通報の理由", () => {
  test("空・空白だけは送れない。長すぎても送れない。前後の空白は数えない", () => {
    expect(reportProblem("")).toContain("書いてください");
    expect(reportProblem("   ")).toContain("書いてください");
    expect(reportProblem("あ".repeat(REPORT_REASON_MAX + 1))).toContain("500 文字");
    expect(reportProblem("あ".repeat(REPORT_REASON_MAX))).toBeUndefined();
    expect(reportProblem("  他人の写真です  ")).toBeUndefined();
  });
});

describe("文と、注文できるか", () => {
  test("作者の表示", () => {
    expect(authorLine("たろう")).toBe("たろう さんの作品");
  });

  test("公開中で、受付中のときだけ、注文できる。受付が止まっているときは、その案内を出す", () => {
    expect(
      orderBlockedReason({ accepting: true, busyMessage: null, entryStatus: "public" }),
    ).toBeUndefined();
    expect(
      orderBlockedReason({
        accepting: false,
        busyMessage: "ただいま混み合っています",
        entryStatus: "public",
      }),
    ).toBe("ただいま混み合っています");
    expect(
      orderBlockedReason({ accepting: false, busyMessage: null, entryStatus: "public" }),
    ).toContain("受け付けていません");
    // 公開中でなければ、受付中でも、注文できない
    for (const status of ["pending_review", "rejected", "hidden"]) {
      expect(
        orderBlockedReason({ accepting: true, busyMessage: null, entryStatus: status }),
      ).toContain("注文できません");
    }
  });
});
