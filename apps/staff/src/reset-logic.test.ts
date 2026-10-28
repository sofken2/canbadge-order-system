import { describe, expect, test } from "bun:test";
import {
  blockerCopy,
  deletedLine,
  doneMessage,
  isResetConfirmed,
  unfinishedWarning,
} from "./reset-logic";

const counts = {
  orders: 12,
  unfinishedOrders: 0,
  printSheets: 4,
  archiveEntries: 5,
  reports: 1,
};

describe("リセットの確認の文字", () => {
  test("「リセット」と、そのまま打ち込んだときだけ、合う。前後の空白は、見逃す", () => {
    expect(isResetConfirmed("リセット")).toBe(true);
    expect(isResetConfirmed("  リセット ")).toBe(true);
    expect(isResetConfirmed("")).toBe(false);
    expect(isResetConfirmed("りせっと")).toBe(false);
    expect(isResetConfirmed("リセット中")).toBe(false);
    expect(isResetConfirmed("reset")).toBe(false);
  });
});

describe("リセットの文言", () => {
  test("消えるものの件数を、そのまま出す", () => {
    expect(deletedLine(counts)).toBe(
      "消えるもの：注文 12 件（売上を含む）・印刷シート 4 枚・アーカイブの作品 5 件と通報 1 件",
    );
  });

  test("終わっていない注文があるときだけ、注意を出す", () => {
    expect(unfinishedWarning(counts)).toBeUndefined();
    expect(unfinishedWarning({ ...counts, unfinishedOrders: 3 })).toContain("3 件");
  });

  test("実行できない理由は、何が起きているか → どうするか、の順で、叫ばない", () => {
    for (const text of Object.values(blockerCopy)) {
      expect(text.endsWith("。")).toBe(true);
      expect(text).not.toContain("！");
    }
  });

  test("終わったあとの案内に、退避の場所と、次にすることが入る", () => {
    const text = doneMessage({ backupName: "old-20261028-163000", deleted: counts });
    expect(text).toContain("old-20261028-163000");
    expect(text).toContain("営業を開始する");
  });
});
