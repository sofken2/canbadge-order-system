import { describe, expect, test } from "bun:test";
import {
  distinctNumbers,
  isReprintableOrderStatus,
  type ReprintTarget,
  reprintImpact,
  reprintResultMessage,
  sheetTally,
  splitReprintable,
  toggled,
} from "./print-logic";

const target = (
  orderNumber: number,
  orderStatus: ReprintTarget["orderStatus"],
  id = `i${orderNumber}`,
): ReprintTarget => ({
  orderItemId: id,
  orderNumber,
  orderNumberText: String(orderNumber).padStart(3, "0"),
  orderStatus,
});

describe("再印刷できる状態", () => {
  test("印刷済み・組み立て中・完成だけ（受け渡し済み・取り消しなどは、できない）", () => {
    for (const status of ["printed", "assembling", "ready"] as const) {
      expect(isReprintableOrderStatus(status)).toBe(true);
    }
    for (const status of [
      "submitted",
      "paid",
      "picked_up",
      "expired",
      "cancelled",
      "refunded",
    ] as const) {
      expect(isReprintableOrderStatus(status)).toBe(false);
    }
  });

  test("対象を、できるものと、外すものに分ける", () => {
    const { reprintable, excluded } = splitReprintable([
      target(1, "ready"),
      target(2, "picked_up"),
      target(3, "assembling"),
      target(4, "refunded"),
    ]);
    expect(reprintable.map((t) => t.orderNumber)).toEqual([1, 3]);
    expect(excluded.map((t) => t.orderNumber)).toEqual([2, 4]);
  });
});

describe("選択", () => {
  test("選ぶ・外す。もとの集合は変えない", () => {
    const base = new Set(["a"]);
    const added = toggled(base, "b");
    expect([...added]).toEqual(["a", "b"]);
    expect([...toggled(added, "a")]).toEqual(["b"]);
    expect([...base]).toEqual(["a"]);
  });

  test("確認の集計：選ばなかったバッジは OK", () => {
    expect(sheetTally(["a", "b", "c", "d"], new Set(["b"]))).toEqual({ ok: 3, reprint: 1 });
    expect(sheetTally(["a", "b"], new Set())).toEqual({ ok: 2, reprint: 0 });
    expect(sheetTally(["a", "b"], new Set(["a", "b"]))).toEqual({ ok: 0, reprint: 2 });
  });

  test("シートにない ID が混ざっていても、数えない", () => {
    expect(sheetTally(["a", "b"], new Set(["zzz"]))).toEqual({ ok: 2, reprint: 0 });
  });
});

describe("再印刷の影響の説明", () => {
  test("注文番号は、小さい順で、重複しない（1 つの注文に、複数のバッジがあっても）", () => {
    expect(
      distinctNumbers([
        target(12, "ready", "a"),
        target(3, "ready", "b"),
        target(12, "ready", "c"),
      ]),
    ).toEqual(["003", "012"]);
  });

  test("状態ごとに、影響を分ける。完成は、呼び出しモニターから消えることを、組み立て中は、作り直しを伝える", () => {
    const lines = reprintImpact([
      target(5, "ready"),
      target(7, "assembling"),
      target(2, "printed"),
      target(9, "ready"),
    ]);
    expect(lines.map((line) => line.status)).toEqual(["printed", "assembling", "ready"]);
    expect(lines.find((line) => line.status === "ready")?.numbers).toEqual(["005", "009"]);
    expect(lines.find((line) => line.status === "ready")?.text).toContain("呼び出しモニター");
    expect(lines.find((line) => line.status === "assembling")?.text).toContain("作り直し");
    expect(lines.find((line) => line.status === "printed")?.text).toContain(
      "「印刷待ち」に戻ります",
    );
  });

  test("対象がなければ、説明もない", () => {
    expect(reprintImpact([])).toEqual([]);
  });
});

describe("結果のメッセージ", () => {
  test("戻した数と、すでに印刷待ちだった数を伝える", () => {
    expect(reprintResultMessage({ reprintedItemIds: ["a", "b"], skippedItemIds: [] })).toContain(
      "2 個を、印刷待ちに戻しました",
    );
    expect(reprintResultMessage({ reprintedItemIds: ["a"], skippedItemIds: ["b"] })).toContain(
      "すでに印刷待ちの 1 個",
    );
    expect(reprintResultMessage({ reprintedItemIds: [], skippedItemIds: ["b", "c"] })).toContain(
      "何も変えていません",
    );
  });
});
