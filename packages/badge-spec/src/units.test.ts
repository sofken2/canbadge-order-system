import { describe, expect, test } from "bun:test";
import { mmToPt, mmToPx, pxToMm } from "./units";

describe("mm からピクセル", () => {
  test("1 インチ（25.4mm）は、dpi と同じピクセル数", () => {
    expect(mmToPx(25.4, 300)).toBe(300);
    expect(mmToPx(25.4, 600)).toBe(600);
  });

  test("整数に四捨五入する（70mm・300dpi は 826.77 → 827px）", () => {
    expect(mmToPx(70, 300)).toBe(827);
    expect(Number.isInteger(mmToPx(58, 300))).toBe(true);
  });

  test("0mm は 0px", () => {
    expect(mmToPx(0, 300)).toBe(0);
  });

  test("ピクセルから mm に戻すと、1px 分（0.1mm 未満）の誤差に収まる", () => {
    expect(pxToMm(300, 300)).toBeCloseTo(25.4, 10);
    expect(Math.abs(pxToMm(mmToPx(70, 300), 300) - 70)).toBeLessThan(0.1);
  });
});

describe("mm からポイント", () => {
  test("1 インチ（25.4mm）は 72pt", () => {
    expect(mmToPt(25.4)).toBeCloseTo(72, 10);
  });

  test("丸めずに小数のまま返す（70mm は 198.425...pt）", () => {
    expect(mmToPt(70)).toBeCloseTo(198.4252, 3);
  });
});
