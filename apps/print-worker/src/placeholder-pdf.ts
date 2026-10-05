import { badgeSpec, mmToPt } from "@canbadge/badge-spec";
import { PDFDocument, StandardFonts } from "pdf-lib";

export type PlaceholderSlot = { position: number; orderNumberText: string };

/**
 * シートの PDF の代わりになる、文字だけの 1 ページ。**本物の面付け（バッジの画像と注文番号を
 * 実寸で並べる）は P01 で作り、これを置き換える。** 開発用ドライバーが、PDF を出力できることを
 * 確かめるためのもの。標準フォントは日本語を描けないので、ASCII の文字だけを描く
 */
export async function renderPlaceholderPdf(input: {
  sheetKey: string;
  slots: PlaceholderSlot[];
}): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage([mmToPt(badgeSpec.paper.widthMm), mmToPt(badgeSpec.paper.heightMm)]);
  const left = mmToPt(badgeSpec.paper.unprintableMarginMm + 10);

  let y = page.getHeight() - mmToPt(badgeSpec.paper.unprintableMarginMm + 15);
  page.drawText("CANBADGE PLACEHOLDER SHEET (real layout: P01)", { x: left, y, size: 14, font });
  y -= 22;
  page.drawText(`sheet ${input.sheetKey}`, { x: left, y, size: 10, font });
  for (const slot of input.slots) {
    y -= 24;
    page.drawText(`slot ${slot.position + 1}: order #${slot.orderNumberText}`, {
      x: left,
      y,
      size: 16,
      font,
    });
  }
  return await doc.save();
}
