import { describe, expect, test } from "bun:test";
import {
  type BadgeSpec,
  badgeSpec,
  printableAreaMm,
  printDiameterMm,
  slotsPerSheet,
} from "@canbadge/badge-spec";
import { calibrate, layoutSizeMm, layoutSlots } from "./layout";

describe("面付けの配置", () => {
  const slots = layoutSlots(badgeSpec, slotsPerSheet(badgeSpec));
  const d = printDiameterMm(badgeSpec);

  test("1 枚に 6 個（2 列 × 3 行）。印刷円の直径は 70mm", () => {
    expect(slots).toHaveLength(6);
    expect(d).toBe(70);
    for (const slot of slots) expect(slot.diameterMm).toBe(70);
  });

  test("並びは、左上から、右へ、次の行へ（S03 の position 順と同じ）", () => {
    expect(slots.map((s) => [s.position, s.row, s.column])).toEqual([
      [0, 0, 0],
      [1, 0, 1],
      [2, 1, 0],
      [3, 1, 1],
      [4, 2, 0],
      [5, 2, 1],
    ]);
    // 右の列は、左の列より右。下の行は、上の行より下
    expect(slots[1]?.centerXMm).toBeGreaterThan(slots[0]?.centerXMm ?? 0);
    expect(slots[2]?.centerYMm).toBeGreaterThan(slots[0]?.centerYMm ?? 0);
  });

  test("隣り合う円の間隔は、設定どおり（左右 5mm・上下は、注文番号の枠 6mm + 5mm）", () => {
    const gapX = (slots[1]?.centerXMm ?? 0) - (slots[0]?.centerXMm ?? 0) - d;
    const rowPitch = (slots[2]?.centerYMm ?? 0) - (slots[0]?.centerYMm ?? 0);
    expect(gapX).toBeCloseTo(badgeSpec.layout.gapXMm, 9);
    expect(rowPitch).toBeCloseTo(d + badgeSpec.layout.labelHeightMm + badgeSpec.layout.gapYMm, 9);
  });

  test("すべて、印刷できる範囲の中に収まる（円も、注文番号の枠も）", () => {
    const margin = badgeSpec.paper.unprintableMarginMm;
    const area = printableAreaMm(badgeSpec);
    for (const slot of slots) {
      expect(slot.centerXMm - d / 2).toBeGreaterThanOrEqual(margin);
      expect(slot.centerXMm + d / 2).toBeLessThanOrEqual(margin + area.widthMm);
      expect(slot.centerYMm - d / 2).toBeGreaterThanOrEqual(margin);
      expect(slot.label.topMm + slot.label.heightMm).toBeLessThanOrEqual(margin + area.heightMm);
    }
  });

  test("面付けの全体は、印刷できる範囲の中央（左右・上下に、同じ余白）", () => {
    const margin = badgeSpec.paper.unprintableMarginMm;
    const area = printableAreaMm(badgeSpec);
    const size = layoutSizeMm(badgeSpec);
    const left = (slots[0]?.centerXMm ?? 0) - d / 2 - margin;
    const lastRight = (slots[1]?.centerXMm ?? 0) + d / 2;
    expect(left).toBeCloseTo(margin + area.widthMm - lastRight, 9);
    const top = (slots[0]?.centerYMm ?? 0) - d / 2 - margin;
    const lastBottom = (slots[5]?.label.topMm ?? 0) + (slots[5]?.label.heightMm ?? 0);
    expect(top).toBeCloseTo(margin + area.heightMm - lastBottom, 9);
    expect(size.widthMm).toBe(2 * 70 + 5);
    expect(size.heightMm).toBe(3 * 76 + 2 * 5);
  });

  test("円同士は、重ならない", () => {
    for (const a of slots) {
      for (const b of slots) {
        if (a.position >= b.position) continue;
        const distance = Math.hypot(a.centerXMm - b.centerXMm, a.centerYMm - b.centerYMm);
        expect(distance).toBeGreaterThanOrEqual(d);
      }
    }
  });

  test("注文番号の枠は、円の真下で、円の中心と同じ x", () => {
    for (const slot of slots) {
      expect(slot.label.centerXMm).toBe(slot.centerXMm);
      expect(slot.label.topMm).toBeCloseTo(slot.centerYMm + d / 2, 9);
      expect(slot.label.heightMm).toBe(badgeSpec.layout.labelHeightMm);
    }
  });

  test("数が少ないシートは、先頭の位置から埋める（位置は、数に関係なく同じ）", () => {
    const two = layoutSlots(badgeSpec, 2);
    expect(two).toEqual(slots.slice(0, 2));
    expect(layoutSlots(badgeSpec, 0)).toEqual([]);
  });

  test("載せられる数を超えたら、断る。負の数・小数も断る", () => {
    expect(() => layoutSlots(badgeSpec, 7)).toThrow("6 個まで");
    expect(() => layoutSlots(badgeSpec, -1)).toThrow();
    expect(() => layoutSlots(badgeSpec, 1.5)).toThrow();
  });

  test("設定を変えると、配置が追従する（3 列にできる小さなバッジ）", () => {
    const small: BadgeSpec = {
      ...badgeSpec,
      diameterMm: 40,
      bleedMm: 5,
      layout: { ...badgeSpec.layout, columns: 3, rows: 4 },
    };
    const placed = layoutSlots(small, 12);
    expect(placed).toHaveLength(12);
    expect(placed[0]?.diameterMm).toBe(50);
    expect(placed[11]).toMatchObject({ row: 3, column: 2 });
  });
});

describe("較正の変換", () => {
  const identity = { scaleX: 1, scaleY: 1, offsetXMm: 0, offsetYMm: 0 };

  test("補正なし（倍率 1・ずらしなし）は、そのまま", () => {
    expect(calibrate({ xMm: 12.5, yMm: 99 }, identity)).toEqual({ xMm: 12.5, yMm: 99 });
  });

  test("倍率は、用紙の左上を基準に掛かる。実測が小さいとき（倍率 > 1）は、大きく描く", () => {
    const result = calibrate({ xMm: 100, yMm: 200 }, { ...identity, scaleX: 1.01, scaleY: 1.02 });
    expect(result.xMm).toBeCloseTo(101, 9);
    expect(result.yMm).toBeCloseTo(204, 9);
  });

  test("ずらしは、正なら右・下へ動く", () => {
    expect(calibrate({ xMm: 10, yMm: 10 }, { ...identity, offsetXMm: 1.5, offsetYMm: -2 })).toEqual(
      { xMm: 11.5, yMm: 8 },
    );
  });
});
