import {
  type BadgeSpec,
  printableAreaMm,
  printDiameterMm,
  slotsPerSheet,
} from "@canbadge/badge-spec";

// 用紙の上の、バッジの配置（面付け）。mm で、用紙の左上を原点に、右が x・下が y。
// 画面を持たない純粋な計算なので、テストで、実寸と並びを確かめられる。

/** 用紙の上の、バッジ 1 個分の場所 */
export type SlotPlacement = {
  /** 用紙の何番目か（0 から）。左上から、右へ、次の行へ（行ごとに左から右）。S03 の画面の並び順と同じ */
  position: number;
  column: number;
  row: number;
  /** 印刷する円（塗り足しまで）の中心 */
  centerXMm: number;
  centerYMm: number;
  /** 印刷する円の直径 */
  diameterMm: number;
  /** 注文番号を印字する枠（円の下）。中心の x と、枠の上端・高さ */
  label: { centerXMm: number; topMm: number; heightMm: number };
};

/** 面付けの全体の大きさ（バッジと注文番号の枠を並べた長方形） */
export function layoutSizeMm(spec: BadgeSpec): { widthMm: number; heightMm: number } {
  const d = printDiameterMm(spec);
  const { columns, rows, gapXMm, gapYMm, labelHeightMm } = spec.layout;
  return {
    widthMm: columns * d + (columns - 1) * gapXMm,
    heightMm: rows * (d + labelHeightMm) + (rows - 1) * gapYMm,
  };
}

/**
 * count 個のバッジを、用紙に並べる。面付けの全体は、印刷できる範囲（用紙から印刷できない縁を除いた範囲）の中央に置く。
 * 1 枚に載る数（列 × 行）を超えるときは、断る（呼ぶ側が、シートを分ける）
 */
export function layoutSlots(spec: BadgeSpec, count: number): SlotPlacement[] {
  const capacity = slotsPerSheet(spec);
  if (!Number.isInteger(count) || count < 0 || count > capacity) {
    throw new Error(`1 枚に載せられるのは ${capacity} 個までです（${count} 個）`);
  }
  const d = printDiameterMm(spec);
  const { columns, gapXMm, gapYMm, labelHeightMm } = spec.layout;
  const printable = printableAreaMm(spec);
  const size = layoutSizeMm(spec);
  const margin = spec.paper.unprintableMarginMm;
  const left = margin + (printable.widthMm - size.widthMm) / 2;
  const top = margin + (printable.heightMm - size.heightMm) / 2;

  return Array.from({ length: count }, (_, position) => {
    const column = position % columns;
    const row = Math.floor(position / columns);
    const x = left + column * (d + gapXMm);
    const y = top + row * (d + labelHeightMm + gapYMm);
    return {
      position,
      column,
      row,
      centerXMm: x + d / 2,
      centerYMm: y + d / 2,
      diameterMm: d,
      label: { centerXMm: x + d / 2, topMm: y + d, heightMm: labelHeightMm },
    };
  });
}

/**
 * 較正（P03）。実測のずれを打ち消す変換。用紙の左上を原点に、x' = x × scaleX + offsetX、y' = y × scaleY + offsetY
 * （y は下向き。offset が正なら、右・下へ動く）。PDF の全体に、この変換を掛ける
 */
export function calibrate(
  point: { xMm: number; yMm: number },
  calibration: BadgeSpec["calibration"],
): { xMm: number; yMm: number } {
  return {
    xMm: point.xMm * calibration.scaleX + calibration.offsetXMm,
    yMm: point.yMm * calibration.scaleY + calibration.offsetYMm,
  };
}
