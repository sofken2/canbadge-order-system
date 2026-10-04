// 寸法は mm で持ち、px や pt への換算は必ずこの関数を通す。
// 各所で自前の計算をすると、丸めの違いが誤差になって、画面と印刷で大きさがずれる。

export const MM_PER_INCH = 25.4;

/** PDF の単位（ポイント）。1 インチ = 72pt */
export const PT_PER_INCH = 72;

/**
 * mm を、指定した解像度（dpi）でのピクセル数にする。画像の大きさは整数でなければ
 * ならないので、四捨五入した整数を返す（例: 70mm・300dpi → 827px）
 */
export function mmToPx(mm: number, dpi: number): number {
  return Math.round((mm / MM_PER_INCH) * dpi);
}

/** ピクセル数を mm に戻す。丸めた px から戻すので、元の mm と少しずれることがある */
export function pxToMm(px: number, dpi: number): number {
  return (px / dpi) * MM_PER_INCH;
}

/**
 * mm を PDF のポイントにする。PDF は小数のポイントを扱えるので、丸めない。
 * 面付けは、画像の解像度に関係なく実寸になるよう、この値で配置する
 */
export function mmToPt(mm: number): number {
  return (mm / MM_PER_INCH) * PT_PER_INCH;
}
