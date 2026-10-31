import { describe, expect, test } from "bun:test";
import { KIRA_PATTERNS, kiraRemainingOf, usablePattern } from "./kira-pattern";

describe("キラフィルムの柄", () => {
  test("柄の名前は、契約の表示名", () => {
    expect(KIRA_PATTERNS).toEqual([
      { id: "shards", label: "割れガラス" },
      { id: "aurora", label: "オーロラ" },
    ]);
  });

  test("残りは、状態の応答から、柄ごとに取る。読めないあいだは undefined", () => {
    expect(kiraRemainingOf({ kiraShardsRemaining: 3, kiraAuroraRemaining: 0 })).toEqual({
      shards: 3,
      aurora: 0,
    });
    expect(kiraRemainingOf(undefined)).toBeUndefined();
  });

  test("選んだ柄が売り切れなら、残りのある柄に替える。どちらも売り切れなら、そのまま", () => {
    expect(usablePattern("shards", { shards: 2, aurora: 5 })).toBe("shards");
    expect(usablePattern("shards", { shards: 0, aurora: 5 })).toBe("aurora");
    expect(usablePattern("aurora", { shards: 0, aurora: 0 })).toBe("aurora");
    expect(usablePattern("aurora", undefined)).toBe("aurora");
  });
});
