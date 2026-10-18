/** 読み込んだ写真の、長いほうの辺の上限（px）。スマホの写真は 4000px 以上あり、そのまま扱うとメモリが足りなくなる */
export const MAX_SOURCE_SIDE = 2048;

/**
 * 縦横比を保ったまま、長いほうの辺が上限に収まる大きさにする。上限より小さい写真は、拡大しない。
 * 画素数は整数で、どちらの辺も 1px 以上にする
 */
export function fitWithin(
  width: number,
  height: number,
  maxSide: number = MAX_SOURCE_SIDE,
): { width: number; height: number } {
  const longest = Math.max(width, height);
  if (longest <= maxSide) return { width, height };
  const ratio = maxSide / longest;
  return {
    width: Math.max(1, Math.round(width * ratio)),
    height: Math.max(1, Math.round(height * ratio)),
  };
}

/**
 * 写真がキャンバス（印刷する円を含む正方形）を、すき間なく覆うときの表示幅（mm）。
 * 縦長・横長でも、短いほうの辺がキャンバスに届く
 */
export function coverWidthMm(printDiameterMm: number, aspect: number): number {
  return printDiameterMm * Math.max(1, aspect);
}

/**
 * 一辺 boxMm の正方形の中に、写真の全体を収める幅（余白が出るぶん、cover と違って切れない）。
 * Discord のアイコンのように、端まで絵がある画像を、切らずに見せたいときに使う
 */
export function containWidthMm(boxMm: number, aspect: number): number {
  return boxMm * Math.min(1, aspect);
}

/**
 * 印刷の解像度（dpi）に対する、写真の実効解像度。表示幅 widthMm の中に、元の写真の何画素が入るか。
 * 印刷で粗く見える写真かどうかの判断に使う（目安は 150dpi 以上）
 */
export function effectiveDpi(sourceWidthPx: number, widthMm: number): number {
  return (sourceWidthPx / widthMm) * 25.4;
}
