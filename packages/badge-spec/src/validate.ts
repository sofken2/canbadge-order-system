import { printableAreaMm, printDiameterMm, safeDiameterMm } from "./geometry";
import type { BadgeSpec } from "./spec";

/**
 * 設定に矛盾がないか確かめ、問題の説明を返す（なければ空の配列）。
 * Q01 で値を差し替えたときに、面付けが用紙に収まらないなどの間違いをテストで見つけるために使う
 */
export function validateBadgeSpec(spec: BadgeSpec): string[] {
  const problems: string[] = [];
  const { paper, layout, calibration } = spec;

  if (!(spec.diameterMm > 0)) problems.push("直径は 0 より大きくしてください");
  if (!(spec.bleedMm >= 0)) problems.push("塗り足しは 0 以上にしてください");
  if (!(spec.safeMarginMm >= 0) || !(safeDiameterMm(spec) > 0)) {
    problems.push("安全領域の余白は 0 以上で、直径の半分より小さくしてください");
  }
  if (!Number.isInteger(spec.dpi) || spec.dpi <= 0) problems.push("dpi は正の整数にしてください");

  const printable = printableAreaMm(spec);
  if (!(paper.unprintableMarginMm >= 0) || !(printable.widthMm > 0) || !(printable.heightMm > 0)) {
    problems.push("用紙の印刷できない余白が、用紙の大きさに対して大きすぎます");
  }

  if (!Number.isInteger(layout.columns) || layout.columns < 1) {
    problems.push("面付けの列数は 1 以上の整数にしてください");
  }
  if (!Number.isInteger(layout.rows) || layout.rows < 1) {
    problems.push("面付けの行数は 1 以上の整数にしてください");
  }
  if (layout.gapXMm < 0 || layout.gapYMm < 0 || layout.labelHeightMm < 0) {
    problems.push("面付けの間隔と注文番号の高さは 0 以上にしてください");
  }

  const usedWidth = layout.columns * printDiameterMm(spec) + (layout.columns - 1) * layout.gapXMm;
  const cellHeight = printDiameterMm(spec) + layout.labelHeightMm;
  const usedHeight = layout.rows * cellHeight + (layout.rows - 1) * layout.gapYMm;
  if (usedWidth > printable.widthMm) {
    problems.push(
      `面付けの幅 ${usedWidth}mm が、印刷できる幅 ${printable.widthMm}mm を超えています`,
    );
  }
  if (usedHeight > printable.heightMm) {
    problems.push(
      `面付けの高さ ${usedHeight}mm が、印刷できる高さ ${printable.heightMm}mm を超えています`,
    );
  }

  // 補正が大きすぎるのは、値の入れ間違いの可能性が高い（実測のずれは数 % 以内のはず）
  for (const scale of [calibration.scaleX, calibration.scaleY]) {
    if (!(scale >= 0.9 && scale <= 1.1))
      problems.push("較正の倍率は 0.9〜1.1 の範囲にしてください");
  }

  return problems;
}
