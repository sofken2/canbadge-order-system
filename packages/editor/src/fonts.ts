// 文字に使う書体。Google Fonts から、使う字形だけを読み込む（日本語の書体は、字形ごとに分割されて配信される）。
// キャンバスは、書体を読み込んでからでないと、正しく描けない（読み込み前は、代わりの書体で描かれる）。

export type EditorFont = {
  id: string;
  label: string;
  family: string;
  /** 読み込んでいる太さ。400 以外は、Konva の fontStyle を bold にして使う（無い太さを、擬似的に太らせない） */
  weight: 400 | 700;
  /** Google Fonts にない書体は、assets/fonts に置いて、ここから読む */
  url?: URL;
};

export const EDITOR_FONTS: readonly EditorFont[] = [
  { id: "maru", label: "まるごしっく", family: "Zen Maru Gothic", weight: 700 },
  // チェックポイントフォント（よく飛ばない鳥・商用可）。規約は assets/fonts/checkpoint-readme.txt。
  // 字形・著作権表示を変えての再配布が禁止なので、字を間引かず、woff2 に詰め直しただけで置いている。
  // id は前の書体（Dela Gothic One）のまま。途中保存のデザインが、この書体で開き直されるようにするため
  {
    id: "pop",
    label: "ポップ・極太",
    family: "CheckPoint Font",
    weight: 400,
    url: new URL("./assets/fonts/checkpoint.woff2", import.meta.url),
  },
  { id: "hand", label: "てがき風", family: "Hachi Maru Pop", weight: 400 },
  { id: "mincho", label: "明朝", family: "Shippori Mincho", weight: 700 },
];

export const DEFAULT_FONT = EDITOR_FONTS[0] as EditorFont;

export function findFont(id: string): EditorFont {
  return EDITOR_FONTS.find((font) => font.id === id) ?? DEFAULT_FONT;
}

export const FONT_STYLESHEET_URL =
  "https://fonts.googleapis.com/css2?family=Hachi+Maru+Pop&family=Shippori+Mincho:wght@700&family=Zen+Maru+Gothic:wght@700&display=swap";

/** キャンバスの font（`bold 20px "Zen Maru Gothic", sans-serif` の形）。sizePx は描く大きさ */
export function canvasFont(font: EditorFont, sizePx: number): string {
  return `${font.weight === 700 ? "bold " : ""}${sizePx}px "${font.family}", sans-serif`;
}

let stylesheetAdded = false;

/** 書体の CSS を、ページに 1 回だけ足す。すでにページが読み込んでいる場合は、足さない */
export function ensureFontStylesheet(): void {
  if (stylesheetAdded || typeof document === "undefined") return;
  stylesheetAdded = true;
  // 登録するだけで、ファイル（約 1.2MB）は、その書体で描くとき（document.fonts.load）に初めて読まれる
  for (const font of EDITOR_FONTS) {
    if (!font.url) continue;
    document.fonts.add(
      new FontFace(font.family, `url("${font.url.href}") format("woff2")`, {
        weight: String(font.weight),
        display: "swap",
      }),
    );
  }
  if (document.querySelector(`link[href="${FONT_STYLESHEET_URL}"]`)) return;
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = FONT_STYLESHEET_URL;
  document.head.appendChild(link);
}

/**
 * その文字を描くのに必要な字形を、読み込む。読み込めなくても（回線の不調など）、失敗にはしない
 * （代わりの書体で描かれる）。読み込んだら true
 */
export async function loadFontFor(font: EditorFont, text: string): Promise<boolean> {
  if (typeof document === "undefined") return false;
  ensureFontStylesheet();
  try {
    const loaded = await document.fonts.load(canvasFont(font, 32), text);
    return loaded.length > 0;
  } catch {
    return false;
  }
}
