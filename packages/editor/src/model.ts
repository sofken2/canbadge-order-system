import { type BadgeSpec, printDiameterMm } from "@canbadge/badge-spec";
import { z } from "zod";

// エディタの編集データ（editorData）。再編集と、途中保存（ブラウザ内）で読み戻すための形。
// 契約（shared）の editorData は version を持つ任意のオブジェクトなので、中身の形はここで決め、
// 読み戻すときはここのスキーマで検証する。形を変えるときは version を上げる。
//
// 位置はすべて mm で、キャンバスの中心からの距離（右・下が正）。画面の大きさや印刷の解像度
// （dpi）に依存しないので、Q01 で dpi を変えても、デザインがずれない。

export const EDITOR_DATA_VERSION = 1;

/** 来場者が選ぶ色。#rrggbb の形で持つ（印刷物の色であり、画面のトークンではない） */
export const colorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/);

/** 写真のフィルター。強さ（0〜1）は、あかるく・くっきり・ふんわり に使う（白黒・セピアは使わない） */
export const FILTER_TYPES = ["none", "grayscale", "sepia", "bright", "vivid", "soft"] as const;
export const filterSchema = z.object({
  type: z.enum(FILTER_TYPES),
  strength: z.number().min(0).max(1),
});
export type Filter = z.infer<typeof filterSchema>;

/**
 * 写真の色の補正。フィルターとは別に、重ねてかけられる。どちらも 0〜1（0 は変えない）。
 * skin は、赤い部分（肌）のシアンを抜く補正。saturation は、彩度を上げる補正。
 * 後から足した、省ける項目なので、前の版のデータもそのまま読み戻せる（版は上げない）
 */
export const colorAdjustSchema = z.object({
  skin: z.number().min(0).max(1),
  saturation: z.number().min(0).max(1),
});
export type ColorAdjust = z.infer<typeof colorAdjustSchema>;

/** 文字の長さの上限。バッジは小さいので、長い文字は読めない */
export const MAX_TEXT_LENGTH = 20;

/** 写真の層。写真そのもの（画素）は editorData に入れない（大きいので。ブラウザ内の保存は別に持つ） */
export const imageLayerSchema = z.object({
  type: z.literal("image"),
  /** 中心の位置（キャンバスの中心から、mm） */
  xMm: z.number(),
  yMm: z.number(),
  /** 表示する幅（mm）。高さは、元の写真の縦横比（aspect）から決まる */
  widthMm: z.number().positive(),
  /** 元の写真の 幅 ÷ 高さ。EXIF の向きを直したあとの値 */
  aspect: z.number().positive(),
  rotationDeg: z.number(),
  filter: filterSchema.optional(),
  adjust: colorAdjustSchema.optional(),
});
export type ImageLayer = z.infer<typeof imageLayerSchema>;

/** 文字の層。一行だけ。中心の位置と、文字の大きさ（高さ、mm）を持つ */
export const textLayerSchema = z.object({
  type: z.literal("text"),
  id: z.string().min(1),
  text: z.string().min(1).max(MAX_TEXT_LENGTH),
  /** editor/fonts.ts の書体の ID。知らない ID は、読み戻すとき、既定の書体になる */
  fontId: z.string().min(1),
  color: colorSchema,
  /** ふち（アウトライン）の色。なければ、ふちなし。太さは、文字の大きさに比例する（layers.ts の TEXT_OUTLINE_RATIO） */
  outlineColor: colorSchema.optional(),
  /** ふちの太さ（文字の大きさに対する割合）。なければ、既定の太さ（layers.ts の TEXT_OUTLINE_RATIO） */
  outlineWidth: z.number().min(0.01).max(0.5).optional(),
  fontSizeMm: z.number().positive(),
  xMm: z.number(),
  yMm: z.number(),
  rotationDeg: z.number(),
});
export type TextLayer = z.infer<typeof textLayerSchema>;

/** スタンプの層。形は editor/stickers.ts の ID で決まり、色を選べる */
export const stickerLayerSchema = z.object({
  type: z.literal("sticker"),
  id: z.string().min(1),
  stickerId: z.string().min(1),
  color: colorSchema,
  /** スタンプを収める正方形の一辺（mm） */
  sizeMm: z.number().positive(),
  xMm: z.number(),
  yMm: z.number(),
  rotationDeg: z.number(),
});
export type StickerLayer = z.infer<typeof stickerLayerSchema>;

/** ペンの線の数と、1 本の長さの上限。多すぎると、描画が重く、保存も大きくなる */
export const MAX_STROKES = 300;
export const MAX_STROKE_COORDS = 4000;

/** お絵描きの線の層。点は x, y, x, y, ... の並びで、mm（キャンバスの中心が原点）。線の太さも mm */
export const strokeLayerSchema = z.object({
  type: z.literal("stroke"),
  id: z.string().min(1),
  color: colorSchema,
  widthMm: z.number().positive(),
  points: z
    .array(z.number())
    .min(2)
    .max(MAX_STROKE_COORDS)
    .refine((points) => points.length % 2 === 0, "点は x と y の組で並べる"),
});
export type StrokeLayer = z.infer<typeof strokeLayerSchema>;

export const layerSchema = z.discriminatedUnion("type", [
  imageLayerSchema,
  textLayerSchema,
  stickerLayerSchema,
  strokeLayerSchema,
]);
export type Layer = z.infer<typeof layerSchema>;

export const editorStateSchema = z.object({
  version: z.literal(EDITOR_DATA_VERSION),
  /** 作ったときの寸法。読み戻すときに、いまの設定と違うことに気づくための記録 */
  canvas: z.object({
    printDiameterMm: z.number().positive(),
    dpi: z.number().positive(),
  }),
  background: z.object({
    /** CSS の色。トークンの値ではなく、来場者が選んだ色そのもの */
    color: z.string().min(1),
  }),
  /** 下にある層から順に並ぶ。写真は、あれば先頭（いちばん下） */
  layers: z.array(layerSchema),
});
export type EditorState = z.infer<typeof editorStateSchema>;

/** 背景の初期色。写真を置く前や、写真が透明なときに見える。トークンではなく印刷物の色として白に近い色 */
export const DEFAULT_BACKGROUND = "#ffffff";

export function createEmptyState(spec: BadgeSpec): EditorState {
  return {
    version: EDITOR_DATA_VERSION,
    canvas: { printDiameterMm: printDiameterMm(spec), dpi: spec.dpi },
    background: { color: DEFAULT_BACKGROUND },
    layers: [],
  };
}

/** 保存されていたデータを読み戻す。形が違う・版が違うときは undefined（呼ぶ側は、空から始める） */
export function parseEditorState(value: unknown): EditorState | undefined {
  const parsed = editorStateSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}
