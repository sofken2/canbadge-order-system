import { decodePDFRawStream, PDFDocument, PDFName, PDFRawStream, PDFStream } from "pdf-lib";

// PDF の中身（描画の命令）を読む、テスト用の道具。

/** ページの描画命令を、文字列として読み出す（圧縮されていれば、展開する） */
export async function contentOf(bytes: Uint8Array): Promise<string> {
  const doc = await PDFDocument.load(bytes);
  const parts: string[] = [];
  for (const [, object] of doc.context.enumerateIndirectObjects()) {
    if (object instanceof PDFRawStream) {
      const dict = object.dict;
      if (
        dict.get(PDFName.of("Subtype")) === undefined &&
        dict.get(PDFName.of("Type")) === undefined
      ) {
        parts.push(Buffer.from(decodePDFRawStream(object).decode()).toString("latin1"));
      }
    } else if (object instanceof PDFStream) {
      parts.push(Buffer.from(object.getContents()).toString("latin1"));
    }
  }
  return parts.join("\n");
}

/** 画像の描画ごとの、実寸（pt）。画像の命令は「幅 0 0 高さ 0 0 cm」のあとの「/Image… Do」 */
export function imageDraws(content: string): { widthPt: number; heightPt: number }[] {
  return [
    ...content.matchAll(/([\d.]+) 0 0 ([\d.]+) 0 0 cm\s+1 0 0 1 0 0 cm\s+\/Image-\d+ Do/g),
  ].map((m) => ({ widthPt: Number(m[1]), heightPt: Number(m[2]) }));
}
