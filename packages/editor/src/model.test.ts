import { describe, expect, test } from "bun:test";
import { badgeSpec } from "@canbadge/badge-spec";
import { editorDataSchema } from "@canbadge/shared";
import {
  containWidthMm,
  coverWidthMm,
  effectiveDpi,
  fitWithin,
  MAX_SOURCE_SIDE,
} from "./image-size";
import { newTextLayer } from "./layers";
import { createEmptyState, parseEditorState } from "./model";

describe("編集データ", () => {
  test("空の状態は、契約（shared）の editorData としても通り、保存したものを読み戻せる", () => {
    const state = createEmptyState(badgeSpec);
    expect(editorDataSchema.safeParse(state).success).toBe(true);
    // 寸法は、設定から導いた値（直径 58 + 塗り足し 6 × 2 = 70mm）
    expect(state.canvas.printDiameterMm).toBe(70);

    const withImage = {
      ...state,
      layers: [
        { type: "image" as const, xMm: 1, yMm: -2, widthMm: 80, aspect: 1.5, rotationDeg: 30 },
      ],
    };
    const restored = parseEditorState(JSON.parse(JSON.stringify(withImage)));
    expect(restored).toEqual(withImage);
  });

  test("形が違うもの・版が違うものは、読み戻さない（空から始める）", () => {
    const state = createEmptyState(badgeSpec);
    expect(parseEditorState(undefined)).toBeUndefined();
    expect(parseEditorState({})).toBeUndefined();
    expect(parseEditorState({ ...state, version: 2 })).toBeUndefined();
    expect(parseEditorState({ ...state, layers: [{ type: "unknown" }] })).toBeUndefined();
    // 幅が 0 や負の写真は、描けないので、読み戻さない
    expect(
      parseEditorState({
        ...state,
        layers: [{ type: "image", xMm: 0, yMm: 0, widthMm: 0, aspect: 1, rotationDeg: 0 }],
      }),
    ).toBeUndefined();
  });
});

describe("写真の大きさ", () => {
  test("長いほうの辺が上限を超える写真は、縦横比を保って縮小する", () => {
    expect(fitWithin(4032, 3024)).toEqual({ width: MAX_SOURCE_SIDE, height: 1536 });
    expect(fitWithin(3024, 4032)).toEqual({ width: 1536, height: MAX_SOURCE_SIDE });
  });

  test("上限以下の写真は、拡大も縮小もしない", () => {
    expect(fitWithin(800, 600)).toEqual({ width: 800, height: 600 });
    expect(fitWithin(MAX_SOURCE_SIDE, MAX_SOURCE_SIDE)).toEqual({
      width: MAX_SOURCE_SIDE,
      height: MAX_SOURCE_SIDE,
    });
  });

  test("極端に細長い写真でも、短い辺は 1px 以上になる", () => {
    expect(fitWithin(10000, 1)).toEqual({ width: MAX_SOURCE_SIDE, height: 1 });
  });

  test("キャンバスを覆う幅は、縦長なら直径、横長なら縦横比を掛けた幅", () => {
    expect(coverWidthMm(70, 0.75)).toBe(70);
    expect(coverWidthMm(70, 1)).toBe(70);
    expect(coverWidthMm(70, 1.5)).toBe(105);
  });

  test("収める幅は、正方形の一辺に、縦長なら縦横比を掛けた幅（切れない）", () => {
    expect(containWidthMm(60, 1)).toBe(60);
    expect(containWidthMm(60, 0.5)).toBe(30);
    expect(containWidthMm(60, 2)).toBe(60);
  });

  test("実効解像度：70mm に 827px なら、約 300dpi", () => {
    expect(effectiveDpi(827, 70)).toBeCloseTo(300, 0);
    expect(effectiveDpi(1654, 70)).toBeCloseTo(600, 0);
  });
});

describe("文字のふち", () => {
  test("ふちの色は、保存して読み戻しても残る。ふちのない文字は、項目を持たない", () => {
    const state = createEmptyState(badgeSpec);
    const outlined = newTextLayer("旭祭", {
      fontId: "maru",
      color: "#ffffff",
      outlineColor: "#222222",
      outlineWidth: 0.25,
    });
    const plain = newTextLayer("缶", {
      fontId: "maru",
      color: "#222222",
      outlineColor: "",
      outlineWidth: 0.25,
    });
    expect("outlineColor" in plain).toBe(false);
    const restored = parseEditorState(
      JSON.parse(JSON.stringify({ ...state, layers: [outlined, plain] })),
    );
    const texts = restored?.layers.filter((layer) => layer.type === "text");
    expect(texts?.[0]).toMatchObject({ outlineColor: "#222222", outlineWidth: 0.25 });
    expect(texts?.[1] && "outlineColor" in texts[1]).toBe(false);
  });
});
