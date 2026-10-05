import { badgeSpec, mmToPx, printDiameterMm } from "@canbadge/badge-spec";
import { encodePng } from "./png";

// サンプル画像。すべてコードで描いた自作の絵で、利用条件の問題はない。
// 大きさは、エディタが出力する印刷用の画像（塗り足しを含む円の外接の正方形）と同じにする。

/** 色を 0xRRGGBB の整数で持つ（画素ごとに配列を作らず、速く描くため） */
type Color = number;
type Painter = (x: number, y: number, size: number) => Color;

const lerp = (a: Color, b: Color, t: number): Color => {
  const channel = (shift: number) =>
    Math.round(((a >> shift) & 0xff) * (1 - t) + ((b >> shift) & 0xff) * t);
  return (channel(16) << 16) | (channel(8) << 8) | channel(0);
};

const inCircle = (x: number, y: number, cx: number, cy: number, r: number): boolean =>
  (x - cx) ** 2 + (y - cy) ** 2 <= r * r;

const painters: Record<string, Painter> = {
  // 同心円
  rings: (x, y, s) => {
    const d = Math.hypot(x - s / 2, y - s / 2) / s;
    if (d < 0.04) return 0xe9c46a;
    return Math.floor(d * 24) % 2 === 0 ? 0xf4a261 : 0x264653;
  },
  // 斜めのしま模様と、中央の丸
  stripes: (x, y, s) => {
    if (inCircle(x, y, s / 2, s / 2, s * 0.22)) return 0xe76f51;
    return Math.floor((x + y) / (s / 10)) % 2 === 0 ? 0x2a9d8f : 0xe9f5f2;
  },
  // 市松模様と、中央の白い丸
  checker: (x, y, s) => {
    if (inCircle(x, y, s / 2, s / 2, s * 0.2)) return 0xffffff;
    const cell = s / 8;
    return (Math.floor(x / cell) + Math.floor(y / cell)) % 2 === 0 ? 0x6d597a : 0xeaac8b;
  },
  // 水玉
  dots: (x, y, s) => {
    const spacing = s / 6;
    const row = Math.floor(y / spacing);
    const shifted = x + (row % 2 === 0 ? 0 : spacing / 2);
    const local = {
      x: (shifted % spacing) - spacing / 2,
      y: (y % spacing) - spacing / 2,
    };
    return local.x ** 2 + local.y ** 2 <= (spacing * 0.28) ** 2 ? 0xff8fab : 0xffe5ec;
  },
  // 朝日
  sunrise: (x, y, s) => {
    const horizon = s * 0.65;
    if (y >= horizon) return 0x457b9d;
    if (inCircle(x, y, s / 2, horizon, s * 0.25)) return 0xffd166;
    return lerp(0x1d3557, 0xf4a261, y / horizon);
  },
  // にっこり顔
  smiley: (x, y, s) => {
    const cx = s / 2;
    const cy = s / 2;
    if (inCircle(x, y, cx - s * 0.12, cy - s * 0.08, s * 0.04)) return 0x222222;
    if (inCircle(x, y, cx + s * 0.12, cy - s * 0.08, s * 0.04)) return 0x222222;
    const mouth = Math.hypot(x - cx, y - (cy + s * 0.02));
    if (mouth >= s * 0.2 && mouth <= s * 0.23 && y > cy + s * 0.05) return 0x222222;
    return inCircle(x, y, cx, cy, s * 0.36) ? 0xffd60a : 0x4cc9f0;
  },
};

export const sampleImageNames = Object.keys(painters);

/** サンプル画像の一辺（ピクセル）。印刷円（直径 + 塗り足し）を、印刷解像度で換算した大きさ */
export const sampleImageSize = mmToPx(printDiameterMm(badgeSpec), badgeSpec.dpi);

/** サンプル画像の PNG を描く。同じ名前なら、いつも同じ画像になる */
export function renderSampleImage(name: string): Uint8Array {
  const painter = painters[name];
  if (!painter) throw new Error(`サンプル画像がありません: ${name}`);
  const size = sampleImageSize;
  const rgb = new Uint8Array(size * size * 3);
  let i = 0;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const color = painter(x, y, size);
      rgb[i++] = (color >> 16) & 0xff;
      rgb[i++] = (color >> 8) & 0xff;
      rgb[i++] = color & 0xff;
    }
  }
  return encodePng(size, size, rgb);
}

/**
 * サンプル画像の ID。画像の URL（/api/images/:imageId）は、契約の ID（ULID）で引くので、
 * ファイル名も ULID の形にする。サンプルと分かるよう、固定の値にしている
 */
export const sampleImageIds: Record<string, string> = {
  rings: "01J00000000000000000000001",
  stripes: "01J00000000000000000000002",
  checker: "01J00000000000000000000003",
  dots: "01J00000000000000000000004",
  sunrise: "01J00000000000000000000005",
  smiley: "01J00000000000000000000006",
};

/** データ置き場の images/ 以下に置く、サンプル画像のファイル名（<画像 ID>.png） */
export function sampleImageFile(name: string): string {
  const id = sampleImageIds[name];
  if (!id) throw new Error(`サンプル画像がありません: ${name}`);
  return `${id}.png`;
}
