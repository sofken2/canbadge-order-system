import { describe, expect, test } from "bun:test";
import { encode } from "uqr";
import { qrPathData } from "./qr";

describe("QR のパス", () => {
  test("横に続く黒いマスは、1 つの長方形にまとまり、まわりに余白が付く", () => {
    const modules = [
      [true, true, false, true],
      [false, false, false, false],
      [true, false, true, true],
    ];
    expect(qrPathData(modules, 4)).toBe("M4 4h2v1h-2zM7 4h1v1h-1zM4 6h1v1h-1zM6 6h2v1h-2z");
  });

  test("実際の QR（注文 ID）を、パスにできる。黒いマスの数が、パスの面積と一致する", () => {
    const id = "01M4870CEJ64C2PXCHGP4TWQZT";
    const { data, size } = encode(id, { ecc: "M", border: 0 });
    const path = qrPathData(data);
    expect(size).toBeGreaterThanOrEqual(21);
    // パスの長方形（幅 w × 高さ 1）の幅を足すと、黒いマスの数になる
    const widths = [...path.matchAll(/h(\d+)v1/g)].map((match) => Number(match[1]));
    const dark = data.flat().filter(Boolean).length;
    expect(widths.reduce((sum, width) => sum + width, 0)).toBe(dark);
    // 余白（4 マス）の分だけ、座標が内側から始まる
    expect(path.startsWith("M4 4")).toBe(true);
  });
});
