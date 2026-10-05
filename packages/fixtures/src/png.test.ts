import { describe, expect, test } from "bun:test";
import { inflateSync } from "node:zlib";
import { crc32, encodePng } from "./png";
import { renderSampleImage, sampleImageNames, sampleImageSize } from "./sample-images";
import { renderSamplePdf } from "./sample-pdf";

describe("PNG の作成", () => {
  test("CRC-32 の既知の値と一致する", () => {
    expect(crc32(new TextEncoder().encode("123456789"))).toBe(0xcbf43926);
  });

  test("署名・大きさ・各チャンクの CRC・画素の数が正しい", () => {
    const png = encodePng(3, 2, new Uint8Array(3 * 2 * 3).fill(200));
    const view = new DataView(png.buffer);
    expect([...png.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

    let offset = 8;
    const types: string[] = [];
    let idat: Uint8Array = new Uint8Array(0);
    while (offset < png.length) {
      const length = view.getUint32(offset);
      const type = String.fromCharCode(...png.subarray(offset + 4, offset + 8));
      const body = png.subarray(offset + 8, offset + 8 + length);
      expect(view.getUint32(offset + 8 + length)).toBe(
        crc32(png.subarray(offset + 4, offset + 8 + length)),
      );
      types.push(type);
      if (type === "IHDR") {
        expect([view.getUint32(offset + 8), view.getUint32(offset + 12)]).toEqual([3, 2]);
      }
      if (type === "IDAT") idat = body;
      offset += 12 + length;
    }
    expect(types).toEqual(["IHDR", "IDAT", "IEND"]);
    // 各行の先頭にフィルターの 1 バイトが付く
    expect(inflateSync(idat).length).toBe(2 * (1 + 3 * 3));
  });

  test("画素の数が合わなければ断る", () => {
    expect(() => encodePng(2, 2, new Uint8Array(5))).toThrow();
  });
});

describe("サンプル画像と PDF", () => {
  test("画像は、印刷円の大きさ（827px）の PNG で、同じ名前なら毎回同じ", () => {
    expect(sampleImageSize).toBe(827);
    const name = sampleImageNames[0] ?? "";
    const a = renderSampleImage(name);
    const b = renderSampleImage(name);
    expect(new DataView(a.buffer).getUint32(16)).toBe(827);
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true);
  });

  test("画像は、名前ごとに違う絵になる", () => {
    const sizes = new Set(
      sampleImageNames.map((name) => Buffer.from(renderSampleImage(name)).toString("base64")),
    );
    expect(sizes.size).toBe(sampleImageNames.length);
  });

  test("存在しない画像名は断る", () => {
    expect(() => renderSampleImage("nope")).toThrow();
  });

  test("PDF は、ヘッダーと終端があり、xref の位置が正しい", () => {
    const text = new TextDecoder().decode(renderSamplePdf("sample (1).pdf"));
    expect(text.startsWith("%PDF-1.4")).toBe(true);
    expect(text.trimEnd().endsWith("%%EOF")).toBe(true);
    const startxref = Number(/startxref\n(\d+)/.exec(text)?.[1]);
    expect(text.slice(startxref, startxref + 4)).toBe("xref");
    // 括弧は、PDF の文字列の中でエスケープされる
    expect(text).toContain("sample \\(1\\).pdf");
  });
});
