/**
 * バッジの寸法・解像度・面付けの設定。寸法はすべて mm。
 * エディタ（キャンバスの大きさとガイド）と print-worker（用紙への配置）が、同じ値を参照する。
 */
export type BadgeSpec = {
  /** バッジの見える部分（表の円）の直径 */
  diameterMm: number;
  /**
   * 塗り足し。見える円の外側に、さらに印刷する幅。缶の裏に折り込まれる部分で、
   * 切りずれがあっても白い縁が出ないようにする
   */
  bleedMm: number;
  /** 安全領域。見える円の縁から内側に、文字や顔など大事なものを置かない幅 */
  safeMarginMm: number;
  /** 印刷解像度（dpi）。エディタが出力する PNG の画素数に使う */
  dpi: number;
  /** 用紙 */
  paper: {
    widthMm: number;
    heightMm: number;
    /** プリンターが印刷できない縁の幅（フチあり印刷）。実機のテスト印刷で決める */
    unprintableMarginMm: number;
  };
  /** 面付け。バッジを用紙に並べる数と間隔。1 枚に載る数は columns × rows */
  layout: {
    columns: number;
    rows: number;
    /** 左右に隣り合う印刷円の間隔 */
    gapXMm: number;
    /** 上下に隣り合うセルの間隔 */
    gapYMm: number;
    /** 各バッジの下に、注文番号を印字する高さ */
    labelHeightMm: number;
  };
  /**
   * 較正。較正用ページを印刷して定規で実測し、ずれを打ち消す補正値（P03）。
   * scale は PDF の寸法に掛ける倍率で、実測が指定より小さいときは 1 より大きくする。
   * offset は、配置を動かす量
   */
  calibration: {
    scaleX: number;
    scaleY: number;
    offsetXMm: number;
    offsetYMm: number;
  };
};

/**
 * 現在の設定。
 * - **確定**：バッジの見える円の直径 58mm（内径）、印刷する円の直径 70mm（塗り足しは、その差の半分で 6mm）。
 *   バッジマシンの寸法の連絡による。印刷円は printDiameterMm(badgeSpec) で 70 になる（テストで固定）
 * - **仮**：安全領域・用紙・面付け・較正・dpi。Q01（設定値の確定）で、実機のテスト印刷
 *   （印刷可能範囲・実測のずれ・仕上がり）を見て、本番の値に差し替える
 *   仮の根拠：A4 の普通紙、300dpi
 */
export const badgeSpec: BadgeSpec = {
  diameterMm: 58,
  bleedMm: 6,
  safeMarginMm: 4,
  dpi: 300,
  paper: { widthMm: 210, heightMm: 297, unprintableMarginMm: 5 },
  layout: { columns: 2, rows: 3, gapXMm: 5, gapYMm: 5, labelHeightMm: 6 },
  // 実機（Canon PIXUS TS6730・Windows 標準の IPP クラスドライバー・A4 普通紙・実際のサイズ 100%）で、
  // 較正用ページを印刷して、定規で実測した結果：
  //   横 150mm の目盛り → 実測 150mm（ずれなし）、縦 250mm の目盛り → 実測 250.5〜251mm（約 0.3% 長い。紙送りの誤差）
  //   円は、70mm・58mm とも、定規の精度では正確
  // 縦は、実測の中央（250.75mm）から、250 ÷ 250.75 = 0.997 に縮めて描く。測定の精度（±0.25mm）が、倍率の ±0.1% にあたる。
  // ずらし（offset）は、測っていないので、0。値を変えたら、`bun run calibration --applied --print` で、縦が 250mm になることを確かめる
  calibration: { scaleX: 1, scaleY: 0.997, offsetXMm: 0, offsetYMm: 0 },
};
