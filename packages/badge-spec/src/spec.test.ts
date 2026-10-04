import { describe, expect, test } from "bun:test";
import { printableAreaMm, printDiameterMm, safeDiameterMm, slotsPerSheet } from "./geometry";
import { type BadgeSpec, badgeSpec } from "./spec";
import { mmToPx } from "./units";
import { validateBadgeSpec } from "./validate";

describe("現在の設定（仮の値）", () => {
  test("矛盾がない", () => {
    expect(validateBadgeSpec(badgeSpec)).toEqual([]);
  });

  test("導く寸法：印刷円は直径 + 塗り足し × 2、安全領域は直径 − 余白 × 2", () => {
    expect(printDiameterMm(badgeSpec)).toBe(70);
    expect(safeDiameterMm(badgeSpec)).toBe(50);
  });

  test("エディタのキャンバスの一辺は、印刷円を印刷解像度でピクセルにした値", () => {
    expect(mmToPx(printDiameterMm(badgeSpec), badgeSpec.dpi)).toBe(827);
  });

  test("面付け数は列 × 行で、印刷できる範囲は用紙から余白を引いた大きさ", () => {
    expect(slotsPerSheet(badgeSpec)).toBe(6);
    expect(printableAreaMm(badgeSpec)).toEqual({ widthMm: 200, heightMm: 287 });
  });
});

describe("設定の検証", () => {
  const withLayout = (layout: Partial<BadgeSpec["layout"]>): BadgeSpec => ({
    ...badgeSpec,
    layout: { ...badgeSpec.layout, ...layout },
  });

  test("面付けが用紙の幅に収まらなければ指摘する", () => {
    const problems = validateBadgeSpec(withLayout({ columns: 3 }));
    expect(problems.some((p) => p.includes("幅"))).toBe(true);
  });

  test("面付けが用紙の高さに収まらなければ指摘する（注文番号の高さも含めて数える）", () => {
    const problems = validateBadgeSpec(withLayout({ rows: 4 }));
    expect(problems.some((p) => p.includes("高さ"))).toBe(true);
  });

  test("列数・行数は 1 以上の整数", () => {
    expect(validateBadgeSpec(withLayout({ columns: 0 })).length).toBeGreaterThan(0);
    expect(validateBadgeSpec(withLayout({ rows: 1.5 })).length).toBeGreaterThan(0);
  });

  test("安全領域の余白が直径の半分以上なら指摘する", () => {
    expect(validateBadgeSpec({ ...badgeSpec, safeMarginMm: 29 }).length).toBeGreaterThan(0);
  });

  test("直径・塗り足し・dpi の不正を指摘する", () => {
    expect(validateBadgeSpec({ ...badgeSpec, diameterMm: 0 }).length).toBeGreaterThan(0);
    expect(validateBadgeSpec({ ...badgeSpec, bleedMm: -1 }).length).toBeGreaterThan(0);
    expect(validateBadgeSpec({ ...badgeSpec, dpi: 300.5 }).length).toBeGreaterThan(0);
  });

  test("印刷できない余白が用紙に対して大きすぎれば指摘する", () => {
    const spec = { ...badgeSpec, paper: { ...badgeSpec.paper, unprintableMarginMm: 120 } };
    expect(validateBadgeSpec(spec).length).toBeGreaterThan(0);
  });

  test("較正の倍率が極端なら、入れ間違いとして指摘する", () => {
    const spec = { ...badgeSpec, calibration: { ...badgeSpec.calibration, scaleX: 2 } };
    expect(validateBadgeSpec(spec).length).toBeGreaterThan(0);
  });
});
