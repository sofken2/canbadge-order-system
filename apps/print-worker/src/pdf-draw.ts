import { type BadgeSpec, mmToPt } from "@canbadge/badge-spec";
import {
  appendBezierCurve,
  clip,
  closePath,
  concatTransformationMatrix,
  endPath,
  moveTo,
  type PDFFont,
  type PDFPage,
  popGraphicsState,
  pushGraphicsState,
  rgb,
} from "pdf-lib";

// PDF に描くための、小さな道具。位置は、用紙の左上を原点にした mm（右が x・下が y）で渡す。
// PDF 自体の座標（ポイント・左下が原点・上が y）への変換は、ここだけで行う。

/** 円を 4 本の曲線で描くときの定数（円に最も近くなる値） */
const KAPPA = 0.5522847498307936;

export type Canvas = {
  page: PDFPage;
  heightMm: number;
  /** 用紙の左上を原点にした mm を、PDF の座標（pt）にする */
  pt: (xMm: number, yMm: number) => { x: number; y: number };
};

export function canvasOf(page: PDFPage, spec: BadgeSpec): Canvas {
  const heightMm = spec.paper.heightMm;
  return {
    page,
    heightMm,
    pt: (xMm, yMm) => ({ x: mmToPt(xMm), y: mmToPt(heightMm - yMm) }),
  };
}

/**
 * 較正（実測のずれの補正）を、これから描くものすべてに掛ける。呼んだあと、popCalibration を呼ぶまで有効。
 * 用紙の左上を原点に、x' = x × scaleX + offsetX、y' = y × scaleY + offsetY（y は下向き）。
 * PDF の座標（左下が原点）では、倍率は左下から掛かるので、左上を基準にするため、平行移動を足す
 */
export function pushCalibration(canvas: Canvas, calibration: BadgeSpec["calibration"]): void {
  // 補正なし（倍率 1・ずらしなし）なら、何も掛けない（余計な変換を、PDF に入れない）。popCalibration も、何もしない
  if (isIdentity(calibration)) return;
  const heightPt = mmToPt(canvas.heightMm);
  const { scaleX, scaleY, offsetXMm, offsetYMm } = calibration;
  canvas.page.pushOperators(
    pushGraphicsState(),
    concatTransformationMatrix(
      scaleX,
      0,
      0,
      scaleY,
      mmToPt(offsetXMm),
      (1 - scaleY) * heightPt - mmToPt(offsetYMm),
    ),
  );
}

export function popCalibration(canvas: Canvas, calibration: BadgeSpec["calibration"]): void {
  if (isIdentity(calibration)) return;
  canvas.page.pushOperators(popGraphicsState());
}

function isIdentity(c: BadgeSpec["calibration"]): boolean {
  return c.scaleX === 1 && c.scaleY === 1 && c.offsetXMm === 0 && c.offsetYMm === 0;
}

/** 円の経路（曲線 4 本）を、描画の命令にする */
function circlePath(cx: number, cy: number, r: number) {
  const c = r * KAPPA;
  return [
    moveTo(cx + r, cy),
    appendBezierCurve(cx + r, cy + c, cx + c, cy + r, cx, cy + r),
    appendBezierCurve(cx - c, cy + r, cx - r, cy + c, cx - r, cy),
    appendBezierCurve(cx - r, cy - c, cx - c, cy - r, cx, cy - r),
    appendBezierCurve(cx + c, cy - r, cx + r, cy - c, cx + r, cy),
    closePath(),
  ];
}

/** 円の中だけに、描画を切り取る。fn の中の描画は、円の外にはみ出さない */
export function withCircleClip(
  canvas: Canvas,
  center: { xMm: number; yMm: number },
  diameterMm: number,
  draw: () => void,
): void {
  const { x, y } = canvas.pt(center.xMm, center.yMm);
  canvas.page.pushOperators(
    pushGraphicsState(),
    ...circlePath(x, y, mmToPt(diameterMm) / 2),
    clip(),
    endPath(),
  );
  draw();
  canvas.page.pushOperators(popGraphicsState());
}

export const grey = (level: number) => rgb(level, level, level);

export function drawLineMm(
  canvas: Canvas,
  from: { xMm: number; yMm: number },
  to: { xMm: number; yMm: number },
  options: { thicknessPt?: number; level?: number } = {},
): void {
  canvas.page.drawLine({
    start: canvas.pt(from.xMm, from.yMm),
    end: canvas.pt(to.xMm, to.yMm),
    thickness: options.thicknessPt ?? 0.5,
    color: grey(options.level ?? 0),
  });
}

export function drawCircleMm(
  canvas: Canvas,
  center: { xMm: number; yMm: number },
  diameterMm: number,
  options: { thicknessPt?: number; level?: number } = {},
): void {
  const { x, y } = canvas.pt(center.xMm, center.yMm);
  canvas.page.drawCircle({
    x,
    y,
    size: mmToPt(diameterMm) / 2,
    borderWidth: options.thicknessPt ?? 0.5,
    borderColor: grey(options.level ?? 0),
  });
}

/** 文字を描く。x は左端、y は文字の下端（ベースライン）の位置。ASCII だけ（標準フォントは日本語を描けない） */
export function drawTextMm(
  canvas: Canvas,
  text: string,
  at: { xMm: number; yMm: number },
  options: { font: PDFFont; sizePt: number; level?: number },
): void {
  const { x, y } = canvas.pt(at.xMm, at.yMm);
  canvas.page.drawText(text, {
    x,
    y,
    size: options.sizePt,
    font: options.font,
    color: grey(options.level ?? 0),
  });
}

/** 文字を、中央ぞろえで描く。幅は、フォントから測る */
export function drawCenteredTextMm(
  canvas: Canvas,
  text: string,
  at: { centerXMm: number; yMm: number },
  options: { font: PDFFont; sizePt: number; level?: number },
): void {
  const widthMm = options.font.widthOfTextAtSize(text, options.sizePt) / mmToPt(1);
  drawTextMm(canvas, text, { xMm: at.centerXMm - widthMm / 2, yMm: at.yMm }, options);
}
