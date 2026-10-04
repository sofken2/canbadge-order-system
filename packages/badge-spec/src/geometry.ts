import type { BadgeSpec } from "./spec";

// 設定から導く寸法。各所で「直径 + 塗り足し × 2」のような計算を書かず、ここを使う。

/** 印刷する円の直径（見える円 + 両側の塗り足し）。エディタのキャンバスの一辺になる */
export function printDiameterMm(spec: BadgeSpec): number {
  return spec.diameterMm + spec.bleedMm * 2;
}

/** 安全領域の直径。この円の中に、大事なものを収める */
export function safeDiameterMm(spec: BadgeSpec): number {
  return spec.diameterMm - spec.safeMarginMm * 2;
}

/** 1 枚の用紙に載るバッジの数（面付け数） */
export function slotsPerSheet(spec: BadgeSpec): number {
  return spec.layout.columns * spec.layout.rows;
}

/** 用紙のうち、印刷できる範囲の幅と高さ */
export function printableAreaMm(spec: BadgeSpec): { widthMm: number; heightMm: number } {
  const margin = spec.paper.unprintableMarginMm * 2;
  return { widthMm: spec.paper.widthMm - margin, heightMm: spec.paper.heightMm - margin };
}
