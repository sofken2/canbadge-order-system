import { type BadgeSpec, mmToPt, printDiameterMm } from "@canbadge/badge-spec";
import { PDFDocument, StandardFonts } from "pdf-lib";
import {
  canvasOf,
  drawCenteredTextMm,
  drawCircleMm,
  drawLineMm,
  drawTextMm,
  popCalibration,
  pushCalibration,
} from "./pdf-draw";

// 較正用ページ（P01 → P03）。実機で印刷し、定規で実測して、badge-spec の較正の値（calibration）を決める。
// 用紙の大きさ・印刷できない縁・実際の寸法のずれを、1 枚で測れるようにする。標準フォントは日本語を描けないので、英語で書く。

/** 目盛りの付いた定規の長さ */
export const RULER_H_MM = 160;
export const RULER_V_MM = 260;
/** 印刷できない縁を見つけるための、入れ子の枠（用紙の縁からの距離） */
export const FRAME_INSETS_MM = [1, 2, 3, 4, 5, 6, 8, 10] as const;

export type CalibrationOptions = {
  /**
   * 今の較正の値（spec.calibration）を、ページに掛けるか。
   * false（既定）：掛けない。実測のずれを測る、いちばん最初の印刷。
   * true：掛ける。値を入れたあとに、ずれが消えたかを確かめる印刷
   */
  applyCalibration?: boolean;
};

/** 定規：mm ごとの目盛り（1mm は短く、5mm は中くらい、10mm は長く）と、10mm ごとの数字 */
function drawHorizontalRuler(
  c: ReturnType<typeof canvasOf>,
  font: Parameters<typeof drawTextMm>[3]["font"],
  from: { xMm: number; yMm: number },
  lengthMm: number,
) {
  drawLineMm(c, from, { xMm: from.xMm + lengthMm, yMm: from.yMm }, { thicknessPt: 0.4 });
  for (let mm = 0; mm <= lengthMm; mm++) {
    const long = mm % 10 === 0 ? 5 : mm % 5 === 0 ? 3 : 1.5;
    drawLineMm(
      c,
      { xMm: from.xMm + mm, yMm: from.yMm },
      { xMm: from.xMm + mm, yMm: from.yMm + long },
      { thicknessPt: mm % 10 === 0 ? 0.5 : 0.25 },
    );
    if (mm % 10 === 0 && mm > 0 && mm < lengthMm) {
      drawCenteredTextMm(
        c,
        String(mm),
        { centerXMm: from.xMm + mm, yMm: from.yMm + 8.5 },
        { font, sizePt: 5.5 },
      );
    }
  }
}

function drawVerticalRuler(
  c: ReturnType<typeof canvasOf>,
  font: Parameters<typeof drawTextMm>[3]["font"],
  from: { xMm: number; yMm: number },
  lengthMm: number,
) {
  drawLineMm(c, from, { xMm: from.xMm, yMm: from.yMm + lengthMm }, { thicknessPt: 0.4 });
  for (let mm = 0; mm <= lengthMm; mm++) {
    const long = mm % 10 === 0 ? 5 : mm % 5 === 0 ? 3 : 1.5;
    drawLineMm(
      c,
      { xMm: from.xMm, yMm: from.yMm + mm },
      { xMm: from.xMm + long, yMm: from.yMm + mm },
      { thicknessPt: mm % 10 === 0 ? 0.5 : 0.25 },
    );
    if (mm % 10 === 0 && mm > 0 && mm < lengthMm) {
      drawTextMm(
        c,
        String(mm),
        { xMm: from.xMm + 6, yMm: from.yMm + mm + 0.9 },
        { font, sizePt: 5.5 },
      );
    }
  }
}

/**
 * 較正用ページ（1 ページ）。
 * - 入れ子の枠（縁から 1〜10mm）：印刷したとき、**全体が見えるいちばん外側の枠**が、プリンターの印刷できない縁の実際の幅
 * - 定規（横 180mm・縦 260mm）：実測して、倍率を出す（scale = 指定の長さ ÷ 実測の長さ）
 * - 中心の十字と、円（印刷円・表の円）：位置のずれと、円の大きさを見る
 */
export async function renderCalibrationPdf(
  spec: BadgeSpec,
  options: CalibrationOptions = {},
): Promise<Uint8Array> {
  const doc = await PDFDocument.create({ updateMetadata: false });
  doc.setTitle("canbadge calibration page");
  doc.setCreator("canbadge print-worker");
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const { widthMm, heightMm } = spec.paper;
  const page = doc.addPage([mmToPt(widthMm), mmToPt(heightMm)]);
  const c = canvasOf(page, spec);

  if (options.applyCalibration) pushCalibration(c, spec.calibration);

  // 入れ子の枠。縁に近いほど濃く。数字は、枠の上辺のすぐ下に、ずらして書く
  FRAME_INSETS_MM.forEach((inset, index) => {
    const left = inset;
    const right = widthMm - inset;
    const top = inset;
    const bottom = heightMm - inset;
    const corners = [
      { xMm: left, yMm: top },
      { xMm: right, yMm: top },
      { xMm: right, yMm: bottom },
      { xMm: left, yMm: bottom },
    ];
    corners.forEach((from, i) => {
      const to = corners[(i + 1) % 4];
      if (to) drawLineMm(c, from, to, { thicknessPt: 0.3 });
    });
    drawTextMm(
      c,
      `${inset}`,
      { xMm: 30 + index * 12, yMm: top + 2.2 },
      { font: regular, sizePt: 5 },
    );
  });

  // 定規：上（横）と、左（縦）
  // 横の定規は、縦の定規（左端）と交わらないよう、右へ寄せる（縦の定規の数字の右から、枠の手前まで）
  drawHorizontalRuler(c, regular, { xMm: 36, yMm: 30 }, RULER_H_MM);
  drawVerticalRuler(c, regular, { xMm: 20, yMm: (heightMm - RULER_V_MM) / 2 }, RULER_V_MM);

  // 中心の十字と、円
  const center = { xMm: widthMm / 2, yMm: heightMm / 2 + 20 };
  const printD = printDiameterMm(spec);
  drawCircleMm(c, center, printD, { thicknessPt: 0.4 });
  drawCircleMm(c, center, spec.diameterMm, { thicknessPt: 0.4 });
  drawLineMm(
    c,
    { xMm: center.xMm - printD / 2 - 5, yMm: center.yMm },
    { xMm: center.xMm + printD / 2 + 5, yMm: center.yMm },
    { thicknessPt: 0.3 },
  );
  drawLineMm(
    c,
    { xMm: center.xMm, yMm: center.yMm - printD / 2 - 5 },
    { xMm: center.xMm, yMm: center.yMm + printD / 2 + 5 },
    { thicknessPt: 0.3 },
  );
  drawCenteredTextMm(
    c,
    `${printD} mm (print) / ${spec.diameterMm} mm (face)`,
    { centerXMm: center.xMm, yMm: center.yMm + printD / 2 + 9 },
    { font: regular, sizePt: 7 },
  );

  // 使い方（英語。ASCII だけ）
  const lines = [
    "CANBADGE CALIBRATION PAGE",
    "Print at 100% (ACTUAL SIZE). Turn OFF 'fit to page' / 'shrink to printable area'.",
    `Paper ${widthMm} x ${heightMm} mm. ${
      options.applyCalibration
        ? "Calibration APPLIED (verification print)."
        : "Calibration NOT applied (measurement print)."
    }`,
    "1. Frames: the OUTERMOST frame that is fully visible = real unprintable margin in mm.",
    `2. Rulers: measure the horizontal (${RULER_H_MM} mm) and vertical (${RULER_V_MM} mm) rulers.`,
    `   scaleX = ${RULER_H_MM} / measured_horizontal_mm ,  scaleY = ${RULER_V_MM} / measured_vertical_mm`,
    "3. Circles: measure the two circle diameters with a caliper or ruler.",
    "4. Write the values into badgeSpec.calibration (packages/badge-spec/src/spec.ts),",
    "   then print this page again with --applied and check the rulers read exactly.",
  ];
  const textTop = heightMm - 12 - (lines.length - 1) * 4.2;
  lines.forEach((line, index) => {
    drawTextMm(
      c,
      line,
      { xMm: 40, yMm: textTop + index * 4.2 },
      { font: index === 0 ? bold : regular, sizePt: index === 0 ? 9 : 6.5 },
    );
  });

  if (options.applyCalibration) popCalibration(c, spec.calibration);
  return await doc.save();
}
