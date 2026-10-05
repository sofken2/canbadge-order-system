import { badgeSpec, mmToPt } from "@canbadge/badge-spec";

/**
 * 印刷シートの PDF の代わりになる、1 ページだけの PDF。本物の面付けは print-worker（P01）が作る。
 * スタッフ画面のプレビューが、ファイルを開けることを確かめるために使う。ASCII の文字だけを描く
 */
export function renderSamplePdf(title: string): Uint8Array {
  const escaped = title.replace(/[\\()]/g, (ch) => `\\${ch}`).replace(/[^\x20-\x7e]/g, "?");
  const width = mmToPt(badgeSpec.paper.widthMm).toFixed(2);
  const height = mmToPt(badgeSpec.paper.heightMm).toFixed(2);
  const content = `BT /F1 24 Tf 60 760 Td (CANBADGE SAMPLE SHEET) Tj 0 -36 Td /F1 16 Tf (${escaped}) Tj ET`;

  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${width} ${height}] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>`,
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];

  let body = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((object, index) => {
    offsets.push(body.length);
    body += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = body.length;
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) body += `${String(offset).padStart(10, "0")} 00000 n \n`;
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(body);
}
