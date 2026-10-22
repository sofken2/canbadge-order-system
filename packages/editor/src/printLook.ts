/**
 * 3D の完成予想に貼る絵を、実物（紙にインクジェットで印刷し、透明フィルムをかぶせたもの）に近い見た目にする。
 * CMYK のインクで出せる色に寄せたうえで、画面の色より暗く・少しくすみ、細かいインクの粒と、ごく薄い横すじが乗る。
 * 見た目のための加工で、印刷に使う PNG には手を入れない
 */

import { cmykProof } from "./cmykProof";

/** 3D に貼るときの、画像の一辺の上限（px）。大きい画像は縮めてから加工する（重くしない） */
const MAX_SIZE_PX = 1024;
/** 明るさ。紙の白は、画面の白より暗い（1 で元のまま） */
const BRIGHTNESS = 0.78;
/** 明るいところほど落とす度合い（1 より大きいほど、明るい色が沈む） */
const GAMMA = 1.18;
/** 鮮やかさ。インクは画面ほど鮮やかに出ない（1 で元のまま） */
const SATURATION = 0.9;
/** インクの粒の強さ（0〜255 の明るさの、ゆれ幅） */
const GRAIN = 9;
/** 横すじの強さ（明るさの割合）と、すじの間隔（px） */
const BANDING = 0.018;
const BAND_PX = 3;

type Drawable = CanvasImageSource & { width: number; height: number };

/** 印刷物らしく加工した絵を、キャンバスにして返す。描けない環境では undefined */
export function printLook(source: Drawable): HTMLCanvasElement | undefined {
  const scale = Math.min(1, MAX_SIZE_PX / Math.max(source.width, source.height));
  const width = Math.max(1, Math.round(source.width * scale));
  const height = Math.max(1, Math.round(source.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return undefined;
  ctx.drawImage(source, 0, 0, width, height);

  const image = ctx.getImageData(0, 0, width, height);
  const data = image.data;
  // 同じ絵なら、毎回同じ粒になるよう、決まった種から作る乱数
  let seed = 12345;
  const random = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
  for (let y = 0; y < height; y++) {
    // ヘッドが往復する横すじ。ごく薄く、一定の間隔で
    const band = 1 - (Math.floor(y / BAND_PX) % 2 === 0 ? BANDING : 0);
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      // まず、CMYK のインクで出せる色に寄せる（鮮やかな青や緑は、ここでくすむ）
      let [r, g, b] = cmykProof(
        (data[i] as number) / 255,
        (data[i + 1] as number) / 255,
        (data[i + 2] as number) / 255,
      );
      // 鮮やかさを下げる（明るさの成分へ寄せる）
      const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      r = luma + (r - luma) * SATURATION;
      g = luma + (g - luma) * SATURATION;
      b = luma + (b - luma) * SATURATION;
      // 暗く、明るいところほど沈める
      const tone = (value: number) => Math.max(0, value) ** GAMMA * BRIGHTNESS * band;
      // インクの粒。色ごとにわずかにずらすと、インクの点らしくなる
      const grain = (random() - 0.5) * GRAIN;
      data[i] = clamp(tone(r) * 255 + grain + (random() - 0.5) * 2);
      data[i + 1] = clamp(tone(g) * 255 + grain + (random() - 0.5) * 2);
      data[i + 2] = clamp(tone(b) * 255 + grain + (random() - 0.5) * 2);
    }
  }
  ctx.putImageData(image, 0, 0);
  return canvas;
}

function clamp(value: number): number {
  return Math.min(255, Math.max(0, Math.round(value)));
}
