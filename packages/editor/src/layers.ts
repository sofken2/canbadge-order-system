import { findFont } from "./fonts";
import { clampCenter, clampWidth, type Placement, type Point } from "./gesture";
import {
  type ImageLayer,
  type Layer,
  MAX_STROKE_COORDS,
  MAX_STROKES,
  type StickerLayer,
  type StrokeLayer,
  type TextLayer,
} from "./model";
import { DEFAULT_DECOR_COLOR } from "./palette";

// 層（写真・文字・スタンプ・ペンの線）の操作。画面から切り離した、純粋な関数。
// 写真・文字・スタンプは、中心の位置・大きさ・回転を持つので、gesture.ts の計算（Placement）にそろえて動かす。
// ペンの線は、描くだけで、あとから動かさない（選べない）。

/** 写真の層は 1 つだけなので、固定の ID で選ぶ */
export const IMAGE_ID = "image";

/** 文字とスタンプの合計の上限。多すぎると、描画が重くなる */
export const MAX_DECOR_LAYERS = 30;

export const layerId = (layer: Layer): string => (layer.type === "image" ? IMAGE_ID : layer.id);

/** 動かせる層（選んで、移動・拡大・回転できる）。ペンの線は含まない */
export type MovableLayer = ImageLayer | TextLayer | StickerLayer;
export const isMovable = (layer: Layer): layer is MovableLayer => layer.type !== "stroke";

/** 文字とスタンプ（写真の上に重ねる、動かせる飾り） */
export type DecorLayer = TextLayer | StickerLayer;
export const isDecor = (layer: Layer): layer is DecorLayer =>
  layer.type === "text" || layer.type === "sticker";

export const isStroke = (layer: Layer): layer is StrokeLayer => layer.type === "stroke";

let counter = 0;
/** 層の ID。同じ画面の中で重ならなければよい（保存したものを読み戻したときも、重ならないよう、乱数を混ぜる） */
export function newLayerId(): string {
  counter += 1;
  return `l${Date.now().toString(36)}${counter.toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`;
}

/** 層の、位置・大きさ・回転。大きさ（widthMm）は、写真は幅、文字は文字の高さ、スタンプは一辺 */
export function placementOf(layer: MovableLayer): Placement {
  switch (layer.type) {
    case "image":
      return { x: layer.xMm, y: layer.yMm, widthMm: layer.widthMm, rotationDeg: layer.rotationDeg };
    case "text":
      return {
        x: layer.xMm,
        y: layer.yMm,
        widthMm: layer.fontSizeMm,
        rotationDeg: layer.rotationDeg,
      };
    case "sticker":
      return { x: layer.xMm, y: layer.yMm, widthMm: layer.sizeMm, rotationDeg: layer.rotationDeg };
  }
}

export function withPlacement(layer: MovableLayer, placement: Placement): MovableLayer {
  const position = { xMm: placement.x, yMm: placement.y, rotationDeg: placement.rotationDeg };
  switch (layer.type) {
    case "image":
      return { ...layer, ...position, widthMm: placement.widthMm };
    case "text":
      return { ...layer, ...position, fontSizeMm: placement.widthMm };
    case "sticker":
      return { ...layer, ...position, sizeMm: placement.widthMm };
  }
}

/** 大きさの範囲（mm）。小さすぎると見失い・触れず、大きすぎると描画が重くなる */
export function sizeLimits(
  layer: MovableLayer,
  printDiameterMm: number,
): { min: number; max: number } {
  switch (layer.type) {
    case "image":
      return { min: printDiameterMm * 0.2, max: printDiameterMm * 8 };
    case "text":
      return { min: 3, max: printDiameterMm * 0.8 };
    case "sticker":
      return { min: 6, max: printDiameterMm * 1.2 };
  }
}

/** 位置と大きさを、範囲に収める。中心は、印刷する円の外に出しすぎない */
export function constrainPlacement(
  layer: MovableLayer,
  placement: Placement,
  printDiameterMm: number,
): Placement {
  const { min, max } = sizeLimits(layer, printDiameterMm);
  return clampCenter(clampWidth(placement, min, max), printDiameterMm / 2);
}

export type Extent = { halfWidthMm: number; halfHeightMm: number };

/**
 * タップした点にある層を探す。上にある層（配列の後ろ）から順に見て、最初に当たったものを返す。
 * 指は大きいので、各層の外側に paddingMm の余裕を持たせる。
 * extentOf は、層の（回転する前の）縦横の半分の長さ。文字は、書体で幅が変わるので、呼ぶ側が測る
 */
export function hitTest(
  layers: readonly Layer[],
  point: Point,
  extentOf: (layer: MovableLayer) => Extent,
  paddingMm = 3,
): MovableLayer | undefined {
  for (let index = layers.length - 1; index >= 0; index--) {
    const layer = layers[index];
    // ペンの線は、選べない
    if (!layer || !isMovable(layer)) continue;
    const placement = placementOf(layer);
    const theta = (placement.rotationDeg * Math.PI) / 180;
    const dx = point.x - placement.x;
    const dy = point.y - placement.y;
    // 層の向きを揃えた座標に直して、長方形に入るかを見る
    const localX = dx * Math.cos(theta) + dy * Math.sin(theta);
    const localY = -dx * Math.sin(theta) + dy * Math.cos(theta);
    const extent = extentOf(layer);
    if (
      Math.abs(localX) <= extent.halfWidthMm + paddingMm &&
      Math.abs(localY) <= extent.halfHeightMm + paddingMm
    ) {
      return layer;
    }
  }
  return undefined;
}

/** 文字の高さに対する、描く枠の高さの比（Konva の行の高さ 1 のとき、文字の高さと同じ） */
export const TEXT_BOX_HEIGHT_RATIO = 1;

/** 文字の幅を測る関数（書体を読み込んだあとの、実際の幅）。fontSizeMm 1 あたりの幅を返す */
export type TextMeasurer = (text: string, fontId: string) => number;

export function extentOfLayer(layer: MovableLayer, measureText: TextMeasurer): Extent {
  switch (layer.type) {
    case "image":
      return { halfWidthMm: layer.widthMm / 2, halfHeightMm: layer.widthMm / layer.aspect / 2 };
    case "text": {
      const width = measureText(layer.text, layer.fontId) * layer.fontSizeMm;
      return {
        halfWidthMm: width / 2,
        halfHeightMm: (layer.fontSizeMm * TEXT_BOX_HEIGHT_RATIO) / 2,
      };
    }
    case "sticker":
      return { halfWidthMm: layer.sizeMm / 2, halfHeightMm: layer.sizeMm / 2 };
  }
}

// ---- 層の追加・入れ替え（配列を返す。もとの配列は変えない）----

export function newTextLayer(
  text: string,
  options: { fontId: string; color: string; fontSizeMm?: number },
): TextLayer {
  return {
    type: "text",
    id: newLayerId(),
    text,
    fontId: findFont(options.fontId).id,
    color: options.color,
    fontSizeMm: options.fontSizeMm ?? 12,
    xMm: 0,
    yMm: 0,
    rotationDeg: 0,
  };
}

export function newStickerLayer(
  stickerId: string,
  options: { color?: string; sizeMm?: number } = {},
): StickerLayer {
  return {
    type: "sticker",
    id: newLayerId(),
    stickerId,
    color: options.color ?? DEFAULT_DECOR_COLOR,
    sizeMm: options.sizeMm ?? 18,
    xMm: 0,
    yMm: 0,
    rotationDeg: 0,
  };
}

/** 写真の層を入れる（なければ先頭に足し、あれば置き換える）。写真は、いつも、いちばん下 */
export function setImageLayer(layers: readonly Layer[], image: ImageLayer): Layer[] {
  return [image, ...layers.filter((layer) => layer.type !== "image")];
}

export function addDecorLayer(layers: readonly Layer[], layer: DecorLayer): Layer[] {
  const decorCount = layers.filter(isDecor).length;
  if (decorCount >= MAX_DECOR_LAYERS) return [...layers];
  return [...layers, layer];
}

export function updateLayer(
  layers: readonly Layer[],
  id: string,
  change: (layer: Layer) => Layer,
): Layer[] {
  return layers.map((layer) => (layerId(layer) === id ? change(layer) : layer));
}

export function removeLayer(layers: readonly Layer[], id: string): Layer[] {
  return layers.filter((layer) => layerId(layer) !== id);
}

/** 飾りを、いちばん前（上）に出す。写真は、いつも、いちばん下なので、動かさない */
export function bringToFront(layers: readonly Layer[], id: string): Layer[] {
  const target = layers.find((layer) => layerId(layer) === id);
  if (!target || !isDecor(target)) return [...layers];
  return [...layers.filter((layer) => layerId(layer) !== id), target];
}

/** 次の層を選ぶ（小さくて指で選びにくい飾りを、ボタンで選べるように）。最後の次は、最初に戻る */
export function nextLayerId(
  layers: readonly Layer[],
  currentId: string | undefined,
): string | undefined {
  const ids = layers.filter(isMovable).map(layerId);
  if (ids.length === 0) return undefined;
  const index = currentId === undefined ? -1 : ids.indexOf(currentId);
  return ids[(index + 1) % ids.length];
}

/**
 * 文字が空になった文字の層を取り除く（文字を消している途中は残し、選びなおしたときと、出力のときに取り除く）。
 * keepId の層は、空でも残す（いま直している文字）
 */
export function pruneEmptyText(layers: readonly Layer[], keepId?: string): Layer[] {
  return layers.filter(
    (layer) => layer.type !== "text" || layer.text.trim() !== "" || layer.id === keepId,
  );
}

// ---- ペンの線 ----

export function newStrokeLayer(
  color: string,
  widthMm: number,
  start: { x: number; y: number },
): StrokeLayer {
  // 1 点だけ（ちょん、と触っただけ）でも、丸い点として描けるよう、同じ点を 2 つ持たせる
  return {
    type: "stroke",
    id: newLayerId(),
    color,
    widthMm,
    points: [start.x, start.y, start.x, start.y],
  };
}

/** 描いている線に、点を足す。前の点に近すぎる点は、足さない。長さの上限を超えたら、足さない */
export function appendStrokePoint(
  layers: readonly Layer[],
  id: string,
  point: { x: number; y: number },
  minDistanceMm = 0.25,
): Layer[] {
  return layers.map((layer) => {
    if (layer.type !== "stroke" || layer.id !== id) return layer;
    const count = layer.points.length;
    if (count + 2 > MAX_STROKE_COORDS) return layer;
    const lastX = layer.points[count - 2] ?? point.x;
    const lastY = layer.points[count - 1] ?? point.y;
    if (Math.hypot(point.x - lastX, point.y - lastY) < minDistanceMm) return layer;
    return { ...layer, points: [...layer.points, point.x, point.y] };
  });
}

/** 線を足す。上限（本数）を超えたら、足さない */
export function addStroke(layers: readonly Layer[], stroke: StrokeLayer): Layer[] {
  if (layers.filter(isStroke).length >= MAX_STROKES) return [...layers];
  return [...layers, stroke];
}

/** いちばん新しい線を取り除く（取り消し）。取り除いた線も返す（やり直しのため） */
export function undoStroke(layers: readonly Layer[]): { layers: Layer[]; removed?: StrokeLayer } {
  for (let index = layers.length - 1; index >= 0; index--) {
    const layer = layers[index];
    if (layer && isStroke(layer)) {
      return { layers: [...layers.slice(0, index), ...layers.slice(index + 1)], removed: layer };
    }
  }
  return { layers: [...layers] };
}

export function clearStrokes(layers: readonly Layer[]): Layer[] {
  return layers.filter((layer) => !isStroke(layer));
}

/** ペンの太さの範囲（mm）。バッジは小さいので、細い線から、スタンプのように太い線まで */
export const PEN_MIN_MM = 0.5;
export const PEN_MAX_MM = 8;
export const DEFAULT_PEN_MM = 2;
