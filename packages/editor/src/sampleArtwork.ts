import { type BadgeSpec, printDiameterMm } from "@canbadge/badge-spec";
import { resolveColor } from "./css-color";

/** 見本の画像の一辺（px）。3D で貼るだけなので、印刷の解像度は要らない */
const SIZE_PX = 1024;

/**
 * 見本の下に添える案内。はじめの画面では、缶バッジを押すと写真をはめる画面が開く。
 * 1 行だと、読める大きさにしたときに円の縁にかかるので、2 行に分ける
 */
const NOTE_LINES = ["タップして", "画像を変更"] as const;

/**
 * 3D の見本に貼る、表の絵（塗り足しまで含む正方形の PNG）。
 * 来場者の作品ではなく「ここにあなたのデザインが入る」ことを示す。色と書体はトークンから取る
 */
export async function createSampleArtwork(spec: BadgeSpec): Promise<string> {
  const canvas = document.createElement("canvas");
  canvas.width = SIZE_PX;
  canvas.height = SIZE_PX;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("キャンバスが使えません");

  const pxPerMm = SIZE_PX / printDiameterMm(spec);
  const center = SIZE_PX / 2;
  const fontFamily =
    getComputedStyle(document.documentElement).getPropertyValue("--font-body").trim() ||
    "sans-serif";
  const titleFont = `700 ${Math.round(9 * pxPerMm)}px ${fontFamily}`;
  const noteFont = `700 ${Math.round(4.6 * pxPerMm)}px ${fontFamily}`;
  // 書体の読み込みが済む前に描くと、代わりの書体で焼き付いてしまう
  await Promise.allSettled([
    document.fonts.load(titleFont, "あなたのデザイン"),
    document.fonts.load(noteFont, NOTE_LINES.join("")),
  ]);

  ctx.fillStyle = resolveColor("--color-card", "rgb(252 251 250)");
  ctx.fillRect(0, 0, SIZE_PX, SIZE_PX);

  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = resolveColor("--color-ink", "rgb(38 34 33)");
  ctx.font = titleFont;
  // 見出し 2 行と案内 2 行を、ひとまとまりとして円の中央に置く
  ctx.fillText("あなたの", center, center - 11.5 * pxPerMm);
  ctx.fillText("デザイン", center, center - 1 * pxPerMm);

  // 押せることを伝える文なので、補足の灰色ではなく、押す場所の色（珊瑚の濃いほう）にする
  ctx.fillStyle = resolveColor("--color-accent-deep", "rgb(200 80 64)");
  ctx.font = noteFont;
  ctx.fillText(NOTE_LINES[0], center, center + 8.5 * pxPerMm);
  ctx.fillText(NOTE_LINES[1], center, center + 14 * pxPerMm);

  return canvas.toDataURL("image/png");
}
