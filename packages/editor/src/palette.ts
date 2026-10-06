/**
 * 文字・スタンプ・背景に使う色の候補。来場者のデザインに入る色で、画面のトークンとは別のもの。
 * 白と黒を含め、バッジに映える明るい色を選んでいる。値は #rrggbb（model.ts の colorSchema に合わせる）
 */
export const PALETTE = [
  { color: "#ffffff", label: "白" },
  { color: "#2b2328", label: "黒" },
  { color: "#ff4d6d", label: "赤" },
  { color: "#ff9f1c", label: "オレンジ" },
  { color: "#ffd93d", label: "黄" },
  { color: "#6bcf63", label: "緑" },
  { color: "#3fa7ff", label: "青" },
  { color: "#9b6bff", label: "紫" },
  { color: "#ff8fc7", label: "ピンク" },
] as const;

export const WHITE = PALETTE[0].color;
export const INK = PALETTE[1].color;
export const DEFAULT_DECOR_COLOR = PALETTE[2].color;
