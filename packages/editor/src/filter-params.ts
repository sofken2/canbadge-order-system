import type { Filter } from "./model";

// 写真のフィルターの設定。Konva を使わない、数値の計算だけ（テストできるように、applyFilter とは分ける）。

export type FilterChoice = { type: Filter["type"]; label: string; usesStrength: boolean };

export const FILTER_CHOICES: readonly FilterChoice[] = [
  { type: "none", label: "なし", usesStrength: false },
  { type: "grayscale", label: "白黒", usesStrength: false },
  { type: "sepia", label: "セピア", usesStrength: false },
  { type: "bright", label: "あかるく", usesStrength: true },
  { type: "vivid", label: "くっきり", usesStrength: true },
  { type: "soft", label: "ふんわり", usesStrength: true },
];

export const DEFAULT_STRENGTH = 0.5;

export type FilterParams = {
  grayscale: boolean;
  sepia: boolean;
  /** -1〜1。0 は変えない */
  brightness: number;
  /** Konva の HSL の彩度。0 は変えない */
  saturation: number;
  /** Konva の Contrast。0 は変えない */
  contrast: number;
  /** ぼかす半径（px）。写真の大きさに対する割合で決める */
  blurRadius: number;
};

/** フィルターの種類と強さ（0〜1）を、Konva に渡す数値にする。sourceMaxSide は写真の長いほうの辺（px） */
export function filterParams(filter: Filter | undefined, sourceMaxSide: number): FilterParams {
  const params: FilterParams = {
    grayscale: false,
    sepia: false,
    brightness: 0,
    saturation: 0,
    contrast: 0,
    blurRadius: 0,
  };
  if (!filter) return params;
  switch (filter.type) {
    case "grayscale":
      params.grayscale = true;
      break;
    case "sepia":
      params.sepia = true;
      break;
    case "bright":
      params.brightness = 0.4 * filter.strength;
      break;
    case "vivid":
      params.saturation = 1.6 * filter.strength;
      params.contrast = 30 * filter.strength;
      break;
    case "soft":
      params.blurRadius = Math.round(sourceMaxSide * 0.006 * filter.strength);
      break;
    default:
      break;
  }
  return params;
}

export function hasFilter(filter: Filter | undefined): boolean {
  return filter !== undefined && filter.type !== "none";
}
