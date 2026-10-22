import { describe, expect, test } from "bun:test";
import { adjustPixel, hasColorAdjust } from "./color-adjust";

const SKIN: [number, number, number] = [0.85, 0.62, 0.5];

describe("色の補正", () => {
  test("どちらも 0 なら、補正しない", () => {
    expect(hasColorAdjust(undefined)).toBe(false);
    expect(hasColorAdjust({ skin: 0, saturation: 0 })).toBe(false);
    expect(adjustPixel(...SKIN, { skin: 0, saturation: 0 })).toEqual(SKIN);
  });

  test("肌の補正は、肌の色の赤みを上げ（シアンを抜き）、強いほど効く", () => {
    const weak = adjustPixel(...SKIN, { skin: 0.3, saturation: 0 });
    const strong = adjustPixel(...SKIN, { skin: 1, saturation: 0 });
    expect(weak[0]).toBeGreaterThan(SKIN[0]);
    expect(strong[0]).toBeGreaterThan(weak[0]);
    // 緑と青は変えない
    expect(strong[1]).toBe(SKIN[1]);
    expect(strong[2]).toBe(SKIN[2]);
  });

  test("肌の補正は、灰色・青・緑には効かない", () => {
    for (const color of [
      [0.5, 0.5, 0.5],
      [0.2, 0.3, 0.9],
      [0.2, 0.8, 0.3],
    ] as [number, number, number][]) {
      expect(adjustPixel(...color, { skin: 1, saturation: 0 })).toEqual(color);
    }
  });

  test("彩度を上げると、色みが強くなり、灰色は変わらない", () => {
    const [r, , b] = adjustPixel(...SKIN, { skin: 0, saturation: 1 });
    expect(r - b).toBeGreaterThan(SKIN[0] - SKIN[2]);
    expect(adjustPixel(0.5, 0.5, 0.5, { skin: 0, saturation: 1 })).toEqual([0.5, 0.5, 0.5]);
    // 0〜1 からはみ出さない
    for (const value of adjustPixel(1, 0.1, 0, { skin: 1, saturation: 1 })) {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(1);
    }
  });
});
