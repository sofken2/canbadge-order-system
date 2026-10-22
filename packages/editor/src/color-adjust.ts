import type { ColorAdjust } from "./model";

// 写真の色の補正（肌の補正・彩度）。画素の計算だけ（ブラウザなしでテストできるように、filters.ts とは分ける）。
// 印刷する PNG にも入る（3D の見た目だけの加工ではない）。

/** 肌の補正を最大にしたとき、赤い部分のシアンを何割抜くか */
const MAX_CYAN_CUT = 0.5;
/** 彩度を最大にしたときの倍率 */
const MAX_SATURATION_GAIN = 0.8;
/** 肌・赤みとみなす色相（度）の中心と、そこから効かせる幅 */
const SKIN_HUE_DEG = 25;
const SKIN_HUE_RANGE_DEG = 40;

export function hasColorAdjust(adjust: ColorAdjust | undefined): boolean {
  return adjust !== undefined && (adjust.skin > 0 || adjust.saturation > 0);
}

/** 1 画素（0〜1 の RGB）を補正する */
export function adjustPixel(
  r: number,
  g: number,
  b: number,
  adjust: ColorAdjust,
): [number, number, number] {
  let red = r;
  if (adjust.skin > 0) {
    // インクでは、赤（肌）の部分に混ざるシアンが、くすみ・青白さになる。赤みの強い画素ほど、シアンを抜く
    const weight = skinWeight(r, g, b);
    if (weight > 0) red = 1 - (1 - r) * (1 - MAX_CYAN_CUT * adjust.skin * weight);
  }
  let out: [number, number, number] = [red, g, b];
  if (adjust.saturation > 0) {
    const gain = 1 + MAX_SATURATION_GAIN * adjust.saturation;
    const luma = 0.2126 * out[0] + 0.7152 * out[1] + 0.0722 * out[2];
    out = out.map((value) => luma + (value - luma) * gain) as [number, number, number];
  }
  return [clamp01(out[0]), clamp01(out[1]), clamp01(out[2])];
}

/** RGBA の並び（0〜255）を、その場で補正する */
export function adjustImageData(data: Uint8ClampedArray, adjust: ColorAdjust): void {
  for (let i = 0; i < data.length; i += 4) {
    const [r, g, b] = adjustPixel(
      (data[i] as number) / 255,
      (data[i + 1] as number) / 255,
      (data[i + 2] as number) / 255,
      adjust,
    );
    data[i] = Math.round(r * 255);
    data[i + 1] = Math.round(g * 255);
    data[i + 2] = Math.round(b * 255);
  }
}

/**
 * 赤み（肌の色あたり）の度合い（0〜1）。色相が肌の色に近く、色みがあるほど 1 に近い。
 * 灰色や、青・緑には効かせない（関係のない色まで赤くしない）
 */
function skinWeight(r: number, g: number, b: number): number {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const chroma = max - min;
  if (chroma <= 0 || max !== r) return 0;
  const hue = (((g - b) / chroma) * 60 + 360) % 360;
  const distance = Math.min(Math.abs(hue - SKIN_HUE_DEG), 360 - Math.abs(hue - SKIN_HUE_DEG));
  const hueWeight = Math.max(0, 1 - distance / SKIN_HUE_RANGE_DEG);
  // 色みの弱い画素（ほぼ灰色）は、少しずつ効かせる
  const chromaWeight = Math.min(1, chroma * 4);
  return hueWeight * hueWeight * (3 - 2 * hueWeight) * chromaWeight;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}
