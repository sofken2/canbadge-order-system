import { canvasFont, findFont } from "./fonts";

let context: CanvasRenderingContext2D | null | undefined;

/**
 * 文字の幅を測る。文字の高さ（fontSizeMm）が 1 のときの幅を返すので、実際の幅は、これに fontSizeMm を掛ける。
 * 書体が読み込まれる前は、代わりの書体で測るので、読み込んだあとに測り直す
 */
export function measureTextEm(text: string, fontId: string): number {
  if (typeof document === "undefined") return text.length;
  context ??= document.createElement("canvas").getContext("2d");
  if (!context) return text.length;
  // 小さい値のまま測ると、丸めの誤差が大きいので、大きく測って割る
  context.font = canvasFont(findFont(fontId), 100);
  return context.measureText(text).width / 100;
}
