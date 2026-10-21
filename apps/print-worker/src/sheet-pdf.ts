import { isAbsolute, join, relative, resolve } from "node:path";
import { type BadgeSpec, mmToPt } from "@canbadge/badge-spec";
import { PDFDocument, type PDFImage, StandardFonts } from "pdf-lib";
import { layoutSlots } from "./layout";
import {
  canvasOf,
  drawCenteredTextMm,
  drawCircleMm,
  drawTextMm,
  popCalibration,
  pushCalibration,
  withCircleClip,
} from "./pdf-draw";

// 印刷シートの PDF（P01）。バッジの画像を、実寸（mm）で用紙に並べ、それぞれの下に注文番号を印字する。
// 寸法はすべて badge-spec の値から導く。画像の解像度（画素数）に関係なく、実寸になる。

export type SheetBadge = {
  /** デザイン画像。データ置き場からの相対パス（例: images/<ID>.png） */
  imagePath: string;
  /** 用紙に印字する注文番号（ゼロ埋め済み。例: 012）。ASCII の文字だけ */
  orderNumberText: string;
  /** キラフィルムを貼るバッジ。注文番号の横に「KIRA」と印字して、組み立てで貼り忘れないようにする */
  kira?: boolean;
  /** マグネット加工をするバッジ。同じく「MAGNET」と印字する。キラと両方あれば、並べて印字する */
  magnet?: boolean;
};

/** 追加加工のあるバッジに印字する、注文番号と加工の文字列（例: 007 KIRA MAGNET） */
export const labelText = (badge: SheetBadge): string =>
  [badge.orderNumberText, badge.kira ? "KIRA" : "", badge.magnet ? "MAGNET" : ""]
    .filter((part) => part !== "")
    .join(" ");

export type SheetOptions = {
  /** データ置き場（画像の置き場所の起点） */
  dataDir: string;
  /** シートを見分ける短い文字列（用紙の上に小さく印字する。S03 の画面と照合する手がかり）。ASCII だけ */
  sheetLabel?: string;
  /** 印字する日時（ASCII）。省略すると印字しない */
  printedAtText?: string;
};

const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47];
const JPEG_MAGIC = [0xff, 0xd8, 0xff];
const startsWith = (bytes: Uint8Array, magic: number[]) => magic.every((b, i) => bytes[i] === b);

/** データ置き場の外を指すパス（../ や絶対パス）は、読まない */
function resolveInside(dataDir: string, relativePath: string): string {
  const full = resolve(join(dataDir, relativePath));
  const rel = relative(resolve(dataDir), full);
  if (rel === "" || rel.startsWith("..") || isAbsolute(rel)) {
    throw new Error(`画像のパスがデータ置き場の外を指しています: ${relativePath}`);
  }
  return full;
}

/** 画像を読んで、PDF に埋め込む。形式は、拡張子ではなく中身（先頭の数バイト）で判定する */
async function embedImage(doc: PDFDocument, dataDir: string, path: string): Promise<PDFImage> {
  const file = Bun.file(resolveInside(dataDir, path));
  if (!(await file.exists())) throw new Error(`画像が見つかりません: ${path}`);
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (startsWith(bytes, PNG_MAGIC)) return await doc.embedPng(bytes);
  if (startsWith(bytes, JPEG_MAGIC)) return await doc.embedJpg(bytes);
  throw new Error(`画像の形式が、PNG・JPEG ではありません: ${path}`);
}

/**
 * 画像が、PDF に載せられるかを確かめる（ファイルがある・PNG か JPEG・実際に読める）。
 * 載せられなければ、理由つきで、例外を投げる。印刷キューが、問題のバッジを、シートに載せる前に外すのに使う
 */
export async function checkBadgeImage(dataDir: string, path: string): Promise<void> {
  await embedImage(await PDFDocument.create({ updateMetadata: false }), dataDir, path);
}

/** 画像が正方形でないとき、円を覆うように（短い辺に合わせて拡大し）中央を使う。正方形なら、そのまま */
export function coverRect(
  imageWidth: number,
  imageHeight: number,
  boxMm: number,
): { widthMm: number; heightMm: number } {
  const scale = Math.max(boxMm / imageWidth, boxMm / imageHeight);
  return { widthMm: imageWidth * scale, heightMm: imageHeight * scale };
}

/**
 * 印刷シートの PDF を作る（1 ページ）。badges の並び順が、そのまま用紙の位置（左上から、右へ、次の行へ）になる。
 * 各バッジは、印刷する円（塗り足しまで）の中に切り取って置く。円の縁に、細い灰色の線（切り抜きの目安）を引く。
 * 注文番号は、円の真下に印字する。badge-spec の較正（calibration）を、全体に掛ける
 */
export async function renderSheetPdf(
  spec: BadgeSpec,
  badges: readonly SheetBadge[],
  options: SheetOptions,
): Promise<Uint8Array> {
  const placements = layoutSlots(spec, badges.length);

  const doc = await PDFDocument.create({ updateMetadata: false });
  doc.setTitle("canbadge sheet");
  doc.setCreator("canbadge print-worker");
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage([mmToPt(spec.paper.widthMm), mmToPt(spec.paper.heightMm)]);
  const canvas = canvasOf(page, spec);

  // 同じ画像を何度も埋め込まない（再印刷で、同じ画像が複数載るとき）
  const embedded = new Map<string, PDFImage>();
  const images: PDFImage[] = [];
  for (const badge of badges) {
    let image = embedded.get(badge.imagePath);
    if (!image) {
      image = await embedImage(doc, options.dataDir, badge.imagePath);
      embedded.set(badge.imagePath, image);
    }
    images.push(image);
  }

  pushCalibration(canvas, spec.calibration);

  // シートの名前を、印刷できる範囲の左上に、小さく
  const margin = spec.paper.unprintableMarginMm;
  if (options.sheetLabel) {
    const text = [options.sheetLabel, options.printedAtText].filter(Boolean).join("  ");
    drawTextMm(
      canvas,
      text,
      { xMm: margin + 1, yMm: margin + 4 },
      { font: regular, sizePt: 7, level: 0.45 },
    );
  }

  placements.forEach((slot, index) => {
    const image = images[index];
    const badge = badges[index];
    if (!image || !badge) return;
    const center = { xMm: slot.centerXMm, yMm: slot.centerYMm };

    // 画像は、印刷する円の中だけに描く（円の外の四隅は、印刷しない）
    withCircleClip(canvas, center, slot.diameterMm, () => {
      const size = coverRect(image.width, image.height, slot.diameterMm);
      // 画像の左下の角（PDF の座標）。画像は、円の中心に合わせて置く
      const bottomLeft = canvas.pt(center.xMm - size.widthMm / 2, center.yMm + size.heightMm / 2);
      page.drawImage(image, {
        x: bottomLeft.x,
        y: bottomLeft.y,
        width: mmToPt(size.widthMm),
        height: mmToPt(size.heightMm),
      });
    });

    // 切り抜きの目安の線。印刷する円の縁にあり、缶の裏に折り込まれる部分なので、仕上がりの表には出ない
    drawCircleMm(canvas, center, slot.diameterMm, { thicknessPt: 0.25, level: 0.6 });

    // 注文番号（円の真下の枠の中で、上下中央）と、用紙の何番目か（小さく、枠の左端）
    const fontSizePt = mmToPt(slot.label.heightMm) * 0.78;
    const baselineMm = slot.label.topMm + slot.label.heightMm * 0.78;
    const text = labelText(badge);
    // 加工の文字が付いて長くなっても、円の幅（左端の位置の数字を避けた分）に収める
    const maxWidthPt = mmToPt(slot.diameterMm - 14);
    const labelSizePt = Math.min(
      fontSizePt,
      (fontSizePt * maxWidthPt) / bold.widthOfTextAtSize(text, fontSizePt),
    );
    drawCenteredTextMm(
      canvas,
      text,
      { centerXMm: slot.label.centerXMm, yMm: baselineMm },
      { font: bold, sizePt: labelSizePt },
    );
    drawTextMm(
      canvas,
      String(slot.position + 1),
      { xMm: slot.label.centerXMm - slot.diameterMm / 2, yMm: baselineMm },
      { font: regular, sizePt: fontSizePt * 0.5, level: 0.45 },
    );
  });

  popCalibration(canvas, spec.calibration);
  return await doc.save();
}
