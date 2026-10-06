import { describe, expect, test } from "bun:test";
import { filterParams } from "./filter-params";
import { DEFAULT_FONT, findFont } from "./fonts";
import {
  addDecorLayer,
  addStroke,
  appendStrokePoint,
  bringToFront,
  clearStrokes,
  constrainPlacement,
  extentOfLayer,
  hitTest,
  IMAGE_ID,
  isDecor,
  isMovable,
  isStroke,
  layerId,
  MAX_DECOR_LAYERS,
  type MovableLayer,
  newStickerLayer,
  newStrokeLayer,
  newTextLayer,
  nextLayerId,
  placementOf,
  pruneEmptyText,
  removeLayer,
  setImageLayer,
  undoStroke,
  updateLayer,
  withPlacement,
} from "./layers";
import type { ImageLayer, Layer } from "./model";
import { colorSchema, layerSchema, MAX_STROKE_COORDS, MAX_STROKES } from "./model";
import { PALETTE } from "./palette";
import { findSticker, STICKERS } from "./stickers";

const image: ImageLayer = {
  type: "image",
  xMm: 0,
  yMm: 0,
  widthMm: 70,
  aspect: 1,
  rotationDeg: 0,
};

/** 文字の幅の測り方の代わり。1 文字が、高さと同じ幅 */
const measure = (text: string) => text.length;

const extentOf = (layer: MovableLayer) => extentOfLayer(layer, measure);

describe("層の位置・大きさ", () => {
  test("種類が違っても、位置・大きさ・回転を、同じ形で読み書きできる", () => {
    const text = { ...newTextLayer("ねこ", { fontId: "maru", color: "#ff4d6d" }), xMm: 3, yMm: -4 };
    const sticker = { ...newStickerLayer("heart"), xMm: 5, rotationDeg: 30 };
    expect(placementOf(text)).toEqual({ x: 3, y: -4, widthMm: 12, rotationDeg: 0 });
    expect(placementOf(sticker)).toEqual({ x: 5, y: 0, widthMm: 18, rotationDeg: 30 });
    expect(placementOf(image)).toEqual({ x: 0, y: 0, widthMm: 70, rotationDeg: 0 });

    const moved = withPlacement(text, { x: 1, y: 2, widthMm: 20, rotationDeg: 45 });
    expect(moved).toMatchObject({ type: "text", xMm: 1, yMm: 2, fontSizeMm: 20, rotationDeg: 45 });
    // 位置と大きさ以外（文字・色）は、そのまま
    expect(moved).toMatchObject({ text: "ねこ", color: "#ff4d6d" });
  });

  test("大きさは、種類ごとの範囲に収まる。中心は、印刷する円から出すぎない", () => {
    const sticker = newStickerLayer("star");
    const tiny = constrainPlacement(sticker, { x: 0, y: 0, widthMm: 1, rotationDeg: 0 }, 70);
    expect(tiny.widthMm).toBe(6);
    const huge = constrainPlacement(sticker, { x: 0, y: 0, widthMm: 999, rotationDeg: 0 }, 70);
    expect(huge.widthMm).toBeCloseTo(84);
    const far = constrainPlacement(sticker, { x: 100, y: 0, widthMm: 18, rotationDeg: 0 }, 70);
    expect(far.x).toBeCloseTo(35);
  });
});

describe("タップした層を探す", () => {
  const text = { ...newTextLayer("ABCD", { fontId: "maru", color: "#ffffff" }), xMm: 10, yMm: 10 };
  const sticker = { ...newStickerLayer("heart", { sizeMm: 20 }), xMm: -10, yMm: -10 };
  const layers: Layer[] = [image, sticker, text];

  test("上にある層から順に当たる。何も重ならない場所では、写真に当たる", () => {
    // 文字（中心 10,10、幅 12×4 = 48 の半分 24、高さ 12 の半分 6）
    expect(hitTest(layers, { x: 10, y: 10 }, extentOf)).toBe(text);
    expect(hitTest(layers, { x: -10, y: -10 }, extentOf)).toBe(sticker);
    expect(hitTest(layers, { x: 25, y: -25 }, extentOf)).toBe(image);
  });

  test("重なっていれば、上の層が選ばれる", () => {
    const over = { ...newStickerLayer("star", { sizeMm: 20 }), xMm: -10, yMm: -10 };
    expect(hitTest([image, sticker, over], { x: -10, y: -10 }, extentOf)).toBe(over);
  });

  test("指の太さの分だけ、外側でも当たる。それより外は当たらない", () => {
    // スタンプの縁（-10 ± 10）から、2mm 外
    expect(hitTest([sticker], { x: 2, y: -10 }, extentOf, 3)).toBe(sticker);
    expect(hitTest([sticker], { x: 4, y: -10 }, extentOf, 3)).toBeUndefined();
  });

  test("回転した層は、向きを揃えて判定する", () => {
    // 横に長い文字（半幅 24、半高 6）を 90 度回すと、縦に長くなる
    const rotated = { ...text, xMm: 0, yMm: 0, rotationDeg: 90 };
    expect(hitTest([rotated], { x: 0, y: 20 }, extentOf, 0)).toBe(rotated);
    expect(hitTest([rotated], { x: 20, y: 0 }, extentOf, 0)).toBeUndefined();
  });

  test("層がなければ undefined", () => {
    expect(hitTest([], { x: 0, y: 0 }, extentOf)).toBeUndefined();
  });
});

describe("層の追加・入れ替え", () => {
  test("写真は、いつも先頭（いちばん下）。置き換えても、飾りは残る", () => {
    const sticker = newStickerLayer("heart");
    const text = newTextLayer("a", { fontId: "pop", color: "#2b2328" });
    const withDecor = addDecorLayer(addDecorLayer([], sticker), text);
    const withImage = setImageLayer(withDecor, image);
    expect(withImage.map((layer) => layer.type)).toEqual(["image", "sticker", "text"]);
    const replaced = setImageLayer(withImage, { ...image, widthMm: 80 });
    expect(replaced.map((layer) => layer.type)).toEqual(["image", "sticker", "text"]);
    expect(replaced[0]).toMatchObject({ widthMm: 80 });
  });

  test("飾りには上限がある。超えると、増えない", () => {
    let layers: Layer[] = [image];
    for (let index = 0; index < MAX_DECOR_LAYERS + 5; index++) {
      layers = addDecorLayer(layers, newStickerLayer("star"));
    }
    expect(layers.filter(isDecor).length).toBe(MAX_DECOR_LAYERS);
  });

  test("ID は重ならない。写真は固定の ID", () => {
    const ids = Array.from({ length: 200 }, () => newStickerLayer("star").id);
    expect(new Set(ids).size).toBe(200);
    expect(layerId(image)).toBe(IMAGE_ID);
  });

  test("更新・削除・前に出す。写真は消えず、前にも出ない", () => {
    const a = newStickerLayer("heart");
    const b = newStickerLayer("star");
    const layers: Layer[] = [image, a, b];

    const colored = updateLayer(layers, a.id, (layer) =>
      layer.type === "sticker" ? { ...layer, color: "#6bcf63" } : layer,
    );
    expect(colored[1]).toMatchObject({ color: "#6bcf63" });
    expect(layers[1]).toMatchObject({ color: a.color }); // もとの配列は変わらない

    expect(removeLayer(layers, b.id).map(layerId)).toEqual([IMAGE_ID, a.id]);
    expect(bringToFront(layers, a.id).map(layerId)).toEqual([IMAGE_ID, b.id, a.id]);
    expect(bringToFront(layers, IMAGE_ID).map(layerId)).toEqual([IMAGE_ID, a.id, b.id]);
  });

  test("次の層を選ぶ：順に回り、最後の次は最初に戻る", () => {
    const a = newStickerLayer("heart");
    const layers: Layer[] = [image, a];
    expect(nextLayerId(layers, undefined)).toBe(IMAGE_ID);
    expect(nextLayerId(layers, IMAGE_ID)).toBe(a.id);
    expect(nextLayerId(layers, a.id)).toBe(IMAGE_ID);
    expect(nextLayerId([], undefined)).toBeUndefined();
  });
});

describe("空の文字", () => {
  test("文字が空の層は取り除く。直している途中の層だけ、残せる", () => {
    const empty = { ...newTextLayer("あ", { fontId: "maru", color: "#ffffff" }), text: "  " };
    const filled = newTextLayer("い", { fontId: "maru", color: "#ffffff" });
    const layers: Layer[] = [image, empty, filled];
    expect(pruneEmptyText(layers).map(layerId)).toEqual([IMAGE_ID, filled.id]);
    expect(pruneEmptyText(layers, empty.id).map(layerId)).toEqual([IMAGE_ID, empty.id, filled.id]);
  });
});

describe("書体・色・スタンプの定義", () => {
  test("知らない書体の ID は、既定の書体になる", () => {
    expect(findFont("nothing")).toBe(DEFAULT_FONT);
    expect(newTextLayer("a", { fontId: "nothing", color: "#ffffff" }).fontId).toBe("maru");
  });

  test("パレットの色は、すべて保存できる形（#rrggbb）", () => {
    for (const { color } of PALETTE) expect(colorSchema.safeParse(color).success).toBe(true);
  });

  test("スタンプは、ID が重ならず、パスの数値がすべて有限で、新しい層として保存できる", () => {
    expect(new Set(STICKERS.map((sticker) => sticker.id)).size).toBe(STICKERS.length);
    for (const sticker of STICKERS) {
      expect(findSticker(sticker.id)).toBe(sticker);
      expect(sticker.parts.length).toBeGreaterThan(0);
      for (const part of sticker.parts) {
        expect(part.d.startsWith("M")).toBe(true);
        const numbers = part.d.match(/-?\d+(\.\d+)?/g) ?? [];
        expect(numbers.length).toBeGreaterThan(4);
        expect(numbers.every((value) => Number.isFinite(Number(value)))).toBe(true);
        expect(part.d).not.toContain("NaN");
        if (part.color) expect(colorSchema.safeParse(part.color).success).toBe(true);
      }
      expect(layerSchema.safeParse(newStickerLayer(sticker.id)).success).toBe(true);
    }
  });
});

describe("フィルターの数値", () => {
  test("なし・未指定は、何も変えない", () => {
    const neutral = {
      grayscale: false,
      sepia: false,
      brightness: 0,
      saturation: 0,
      contrast: 0,
      blurRadius: 0,
    };
    expect(filterParams(undefined, 2048)).toEqual(neutral);
    expect(filterParams({ type: "none", strength: 1 }, 2048)).toEqual(neutral);
  });

  test("白黒・セピアは強さを使わない。あかるく・くっきり・ふんわりは強さで変わる", () => {
    expect(filterParams({ type: "grayscale", strength: 0.2 }, 2048).grayscale).toBe(true);
    expect(filterParams({ type: "sepia", strength: 0.9 }, 2048).sepia).toBe(true);

    expect(filterParams({ type: "bright", strength: 0 }, 2048).brightness).toBe(0);
    expect(filterParams({ type: "bright", strength: 1 }, 2048).brightness).toBeCloseTo(0.4);
    const mild = filterParams({ type: "vivid", strength: 0.25 }, 2048);
    const strong = filterParams({ type: "vivid", strength: 1 }, 2048);
    expect(strong.saturation).toBeGreaterThan(mild.saturation);
    expect(strong.contrast).toBeGreaterThan(mild.contrast);
  });

  test("ふんわり（ぼかし）は、写真の大きさに比例する。強さ 0 なら、ぼかさない", () => {
    const small = filterParams({ type: "soft", strength: 1 }, 1000).blurRadius;
    const large = filterParams({ type: "soft", strength: 1 }, 2000).blurRadius;
    expect(large).toBeGreaterThan(small);
    expect(filterParams({ type: "soft", strength: 0 }, 2048).blurRadius).toBe(0);
  });
});

describe("保存データの形", () => {
  test("文字・スタンプ・フィルターつきの写真を、保存して読み戻せる", () => {
    const text = newTextLayer("おめでとう", { fontId: "hand", color: "#ff8fc7" });
    const sticker = newStickerLayer("flower", { color: "#ffd93d" });
    const filtered: ImageLayer = { ...image, filter: { type: "vivid", strength: 0.7 } };
    for (const layer of [text, sticker, filtered]) {
      const restored = layerSchema.parse(JSON.parse(JSON.stringify(layer)));
      expect(restored).toEqual(layer);
    }
  });

  test("空の文字・長すぎる文字・色の形が違うものは、読み戻さない", () => {
    const text = newTextLayer("あ", { fontId: "maru", color: "#ffffff" });
    expect(layerSchema.safeParse({ ...text, text: "" }).success).toBe(false);
    expect(layerSchema.safeParse({ ...text, text: "あ".repeat(21) }).success).toBe(false);
    expect(layerSchema.safeParse({ ...text, color: "red" }).success).toBe(false);
    expect(layerSchema.safeParse({ ...text, fontSizeMm: 0 }).success).toBe(false);
    expect(
      layerSchema.safeParse({ ...image, filter: { type: "sparkle", strength: 0.5 } }).success,
    ).toBe(false);
    expect(layerSchema.safeParse({ ...image, filter: { type: "soft", strength: 2 } }).success).toBe(
      false,
    );
  });
});

describe("ペンの線", () => {
  const start = { x: 1, y: 2 };

  test("触っただけ（動かさない）でも、点として描ける。保存できる形", () => {
    const stroke = newStrokeLayer("#ff4d6d", 2, start);
    expect(stroke.points).toEqual([1, 2, 1, 2]);
    expect(layerSchema.safeParse(stroke).success).toBe(true);
  });

  test("線に、点を足していく。前の点に近すぎる点は、足さない", () => {
    const stroke = newStrokeLayer("#2b2328", 1, start);
    let layers: Layer[] = addStroke([image], stroke);
    layers = appendStrokePoint(layers, stroke.id, { x: 1.1, y: 2 }); // 0.1mm：近すぎる
    layers = appendStrokePoint(layers, stroke.id, { x: 5, y: 6 });
    const drawn = layers.find(isStroke);
    expect(drawn?.points).toEqual([1, 2, 1, 2, 5, 6]);
    // 別の線や、写真には、影響しない
    expect(layers[0]).toBe(image);
    expect(appendStrokePoint(layers, "unknown", { x: 9, y: 9 })).toEqual(layers);
  });

  test("1 本の長さと、本数には上限がある", () => {
    const stroke = newStrokeLayer("#2b2328", 1, start);
    let layers: Layer[] = [stroke];
    for (let index = 0; index < MAX_STROKE_COORDS; index++) {
      layers = appendStrokePoint(layers, stroke.id, { x: index, y: index }, 0);
    }
    const length = layers.find(isStroke)?.points.length ?? 0;
    expect(length).toBeLessThanOrEqual(MAX_STROKE_COORDS);

    let many: Layer[] = [];
    for (let index = 0; index < MAX_STROKES + 10; index++) {
      many = addStroke(many, newStrokeLayer("#2b2328", 1, start));
    }
    expect(many.filter(isStroke).length).toBe(MAX_STROKES);
  });

  test("取り消しは、いちばん新しい線から。取り除いた線は返る（やり直しのため）。線がなければ何もしない", () => {
    const first = newStrokeLayer("#ff4d6d", 1, start);
    const second = newStrokeLayer("#3fa7ff", 1, start);
    const sticker = newStickerLayer("heart");
    const layers: Layer[] = [image, first, sticker, second];

    const undone = undoStroke(layers);
    expect(undone.removed).toBe(second);
    expect(undone.layers.map(layerId)).toEqual([IMAGE_ID, first.id, sticker.id]);

    const again = undoStroke(undone.layers);
    expect(again.removed).toBe(first);
    expect(again.layers.map(layerId)).toEqual([IMAGE_ID, sticker.id]);

    const none = undoStroke(again.layers);
    expect(none.removed).toBeUndefined();
    expect(none.layers.map(layerId)).toEqual([IMAGE_ID, sticker.id]);
  });

  test("全部消しても、写真・文字・スタンプは残る", () => {
    const layers: Layer[] = [image, newStickerLayer("star"), newStrokeLayer("#2b2328", 1, start)];
    expect(clearStrokes(layers).map((layer) => layer.type)).toEqual(["image", "sticker"]);
  });

  test("線は、選べず・動かせず、「次を選ぶ」にも入らない。飾り（文字・スタンプ）には数えない", () => {
    const stroke = newStrokeLayer("#2b2328", 4, { x: 0, y: 0 });
    const sticker = newStickerLayer("heart");
    expect(isMovable(stroke)).toBe(false);
    expect(isDecor(stroke)).toBe(false);
    // 線の上をタップしても、線は選ばれない（下の層が選ばれる）
    expect(hitTest([image, stroke], { x: 0, y: 0 }, extentOf)).toBe(image);
    expect(nextLayerId([image, stroke, sticker], IMAGE_ID)).toBe(sticker.id);
    expect(nextLayerId([stroke], undefined)).toBeUndefined();
    // 飾りの数の上限に、線は入らない
    let layers: Layer[] = [image, stroke];
    for (let index = 0; index < MAX_DECOR_LAYERS; index++) {
      layers = addDecorLayer(layers, newStickerLayer("star"));
    }
    expect(layers.filter(isDecor).length).toBe(MAX_DECOR_LAYERS);
  });

  test("保存データ：点の数が奇数・空・太さ 0 は、読み戻さない", () => {
    const stroke = newStrokeLayer("#2b2328", 2, start);
    expect(layerSchema.safeParse({ ...stroke, points: [1, 2, 3] }).success).toBe(false);
    expect(layerSchema.safeParse({ ...stroke, points: [] }).success).toBe(false);
    expect(layerSchema.safeParse({ ...stroke, widthMm: 0 }).success).toBe(false);
    expect(layerSchema.safeParse({ ...stroke, color: "black" }).success).toBe(false);
  });
});
