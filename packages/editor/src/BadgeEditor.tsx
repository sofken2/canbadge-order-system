import { type BadgeSpec, mmToPx, printDiameterMm, safeDiameterMm } from "@canbadge/badge-spec";
import { Button, Notice } from "@canbadge/ui";
import type Konva from "konva";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Circle, Group, Layer as KonvaLayer, Rect, Shape, Stage } from "react-konva";
import { resolveColor } from "./css-color";
import { clearDraft, loadDraft, saveDraft } from "./draft-store";
import { DEFAULT_STRENGTH, hasFilter } from "./filter-params";
import { applyFilter } from "./filters";
import { ensureFontStylesheet, findFont, loadFontFor } from "./fonts";
import {
  applyDrag,
  applyPinch,
  applyRotation,
  applyZoom,
  coversCircle,
  type Placement,
  type Point,
} from "./gesture";
import { coverWidthMm, effectiveDpi } from "./image-size";
import { LayerNodes } from "./LayerNodes";
import {
  addDecorLayer,
  addStroke,
  appendStrokePoint,
  bringToFront,
  clearStrokes,
  constrainPlacement,
  DEFAULT_PEN_MM,
  extentOfLayer,
  hitTest,
  IMAGE_ID,
  isDecor,
  isMovable,
  isStroke,
  layerId,
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
import { type LoadedImage, loadImage } from "./load-image";
import {
  createEmptyState,
  DEFAULT_BACKGROUND,
  type EditorState,
  type Filter,
  type ImageLayer,
  type Layer,
  parseEditorState,
  type StrokeLayer,
} from "./model";
import {
  BackgroundPanel,
  FilterPanel,
  PenPanel,
  StickerPanel,
  type TextDraft,
  TextPanel,
} from "./Panels";
import { DEFAULT_DECOR_COLOR, INK } from "./palette";
import { measureTextEm } from "./text-measure";

export type BadgeEditorExport = {
  /** 印刷解像度の PNG。ガイド線は入らない */
  png: Blob;
  /** 再編集用のデータ（写真の画素は含まない） */
  editorData: EditorState;
};

export type BadgeEditorProps = {
  spec: BadgeSpec;
  /** 保存してあった編集データ。読み戻せないもの（形・版が違うもの）は、無視して空から始める */
  initialData?: unknown;
  /**
   * 最初から入れておく写真（ファイル、またはその URL）。Discord のアイコンの取り込み（W08）や、
   * ブラウザ内の途中保存からの読み戻しで使う
   */
  initialImage?: Blob | string;
  /**
   * 途中保存の名前。指定すると、作りかけのデザインと写真を、この端末のブラウザ（IndexedDB）に自動で残し、
   * 次に開いたとき、続きから再開する（24 時間まで）。initialData / initialImage があるときは、そちらを使う。
   * 注文が済んだら、呼ぶ側が clearDraft(draftKey) で消す
   */
  draftKey?: string;
  confirmLabel?: string;
  onExport: (result: BadgeEditorExport) => void;
};

const ZOOM_STEP = 1.15;
const ROTATE_STEP_DEG = 15;
/** これより粗い写真は、印刷でぼやける。警告を出す目安（dpi） */
const MIN_RECOMMENDED_DPI = 150;
/** 編集画面の一辺の上限（CSS px）。大きな画面でも、スマホの操作と同じ大きさで確かめられる */
const MAX_DISPLAY_PX = 480;
/** 途中保存を、変更のあと、まとめて書くまでの待ち（ms） */
const DRAFT_SAVE_DELAY_MS = 800;
/** フィルターの強さを動かしている間、写真を作り直すのを待つ時間（ms） */
const FILTER_DELAY_MS = 120;

type Loaded = { image: LoadedImage; aspect: number };
type Tab = "photo" | "text" | "sticker" | "pen" | "background" | "filter";

const TABS: readonly { id: Tab; label: string }[] = [
  { id: "photo", label: "写真" },
  { id: "text", label: "文字" },
  { id: "sticker", label: "スタンプ" },
  { id: "pen", label: "ペン" },
  { id: "background", label: "背景" },
  { id: "filter", label: "フィルター" },
];

const CENTER: Point = { x: 0, y: 0 };
const extentOf = (layer: MovableLayer) => extentOfLayer(layer, measureTextEm);
/** 描き直しの「やり直す」で戻せる線の数。多すぎると、メモリを使う */
const MAX_REDO = 50;
/** 「はじめからやり直す」を、もう一度押すまでの猶予（ms）。押しまちがいで、作りかけを消さないため */
const RESET_CONFIRM_MS = 4000;

export function BadgeEditor({
  spec,
  initialData,
  initialImage,
  draftKey,
  confirmLabel = "これで決定",
  onExport,
}: BadgeEditorProps) {
  const diameter = printDiameterMm(spec);
  const cutRadius = spec.diameterMm / 2;
  const safeRadius = safeDiameterMm(spec) / 2;

  const restored = useMemo(() => parseEditorState(initialData), [initialData]);
  // 写真の層は、写真を読み込んだときに足す。保存してあった文字・スタンプ・線は、最初から入れる
  const [layers, setLayers] = useState<Layer[]>(() =>
    (restored?.layers ?? []).filter((layer) => layer.type !== "image"),
  );
  const [background, setBackground] = useState(restored?.background.color ?? DEFAULT_BACKGROUND);
  const [selectedId, setSelectedId] = useState<string | undefined>(undefined);
  const [loaded, setLoaded] = useState<Loaded | undefined>(undefined);
  const [imageSource, setImageSource] = useState<HTMLCanvasElement | undefined>(undefined);
  const [tab, setTab] = useState<Tab>("photo");
  const [draft, setDraft] = useState<TextDraft>({ text: "", fontId: "maru", color: INK });
  const [stickerColor, setStickerColor] = useState<string>(DEFAULT_DECOR_COLOR);
  const [penColor, setPenColor] = useState<string>(INK);
  const [penWidth, setPenWidth] = useState(DEFAULT_PEN_MM);
  /** 取り消した線（やり直せる）。新しい線を描いたら、空になる */
  const [redoStack, setRedoStack] = useState<StrokeLayer[]>([]);
  const [fontsVersion, setFontsVersion] = useState(0);
  /** 途中保存を調べ終わったか。調べ終わる前に保存すると、残っていた途中保存を、空のデザインで上書きしてしまう */
  const [draftReady, setDraftReady] = useState(
    draftKey === undefined || initialImage !== undefined || initialData !== undefined,
  );
  const [resumed, setResumed] = useState(false);
  const [confirmingReset, setConfirmingReset] = useState(false);
  const [message, setMessage] = useState<string | undefined>(undefined);
  const [busy, setBusy] = useState(false);

  const frameRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<Konva.Stage>(null);
  const guidesRef = useRef<Konva.Layer>(null);
  const [displayPx, setDisplayPx] = useState(320);

  // 画面の幅に合わせて、編集画面の大きさを決める
  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    const update = () => setDisplayPx(Math.min(MAX_DISPLAY_PX, Math.floor(frame.clientWidth)));
    update();
    const observer = new ResizeObserver(update);
    observer.observe(frame);
    return () => observer.disconnect();
  }, []);

  const scale = displayPx / diameter;

  const imageLayer = layers.find((layer): layer is ImageLayer => layer.type === "image");
  /** 選んでいる層。何も選んでいなければ、写真（あれば） */
  const activeId = selectedId ?? (imageLayer ? IMAGE_ID : undefined);
  const active = layers.find(
    (layer): layer is MovableLayer => isMovable(layer) && layerId(layer) === activeId,
  );

  // ---- 書体 ----

  useEffect(() => ensureFontStylesheet(), []);

  // 文字の層にある書体と文字を読み込み、読み込めたら描き直す
  const textKey = layers
    .flatMap((layer) => (layer.type === "text" ? [`${layer.fontId}:${layer.text}`] : []))
    .join("|");
  // biome-ignore lint/correctness/useExhaustiveDependencies: 読み込むのは、書体と文字が変わったときだけ（textKey が、その印）
  useEffect(() => {
    const texts = layers.flatMap((layer) => (layer.type === "text" ? [layer] : []));
    if (texts.length === 0) return;
    let cancelled = false;
    void Promise.all(texts.map((layer) => loadFontFor(findFont(layer.fontId), layer.text))).then(
      () => {
        if (!cancelled) setFontsVersion((version) => version + 1);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [textKey]);

  // ---- 写真の読み込みと、フィルター ----

  const fit = useCallback(
    (aspect: number): Placement => ({
      x: 0,
      y: 0,
      widthMm: coverWidthMm(diameter, aspect),
      rotationDeg: 0,
    }),
    [diameter],
  );

  const accept = useCallback(
    async (source: Blob | string, keep?: ImageLayer) => {
      setMessage(undefined);
      try {
        const image = await loadImage(source);
        const aspect = image.width / image.height;
        setLoaded({ image, aspect });
        setLayers((current) => {
          const previous = current.find((layer): layer is ImageLayer => layer.type === "image");
          const placement = keep ? placementOf(keep) : fit(aspect);
          return setImageLayer(current, {
            type: "image",
            xMm: placement.x,
            yMm: placement.y,
            widthMm: placement.widthMm,
            aspect,
            rotationDeg: placement.rotationDeg,
            // 選びなおしても、かけていたフィルターは残す
            filter: keep?.filter ?? previous?.filter,
          });
        });
        setSelectedId(IMAGE_ID);
      } catch (error) {
        setMessage(error instanceof Error ? error.message : "画像を読み込めませんでした");
      }
    },
    [fit],
  );

  // 最初の写真。保存してあった位置とフィルターがあれば、それを使う
  useEffect(() => {
    if (!initialImage) return;
    const saved = restored?.layers.find((layer): layer is ImageLayer => layer.type === "image");
    void accept(initialImage, saved);
  }, [initialImage, restored, accept]);

  // フィルターをかけた写真を作る。強さを動かしている間は、少し待ってから作る（そのたびに作らない）
  const filter = imageLayer?.filter;
  const filterType = filter?.type;
  const filterStrength = filter?.strength;
  // biome-ignore lint/correctness/useExhaustiveDependencies: filter の中身（種類と強さ）が変わったときだけ作り直す
  useEffect(() => {
    if (!loaded) {
      setImageSource(undefined);
      return;
    }
    const timer = setTimeout(
      () => setImageSource(applyFilter(loaded.image.canvas, filter)),
      hasFilter(filter) ? FILTER_DELAY_MS : 0,
    );
    return () => clearTimeout(timer);
  }, [loaded, filterType, filterStrength]);

  // ---- 層の操作 ----

  const select = useCallback((id: string | undefined) => {
    setSelectedId(id);
    // 空にした文字は、別の層を選んだら、取り除く
    setLayers((current) => pruneEmptyText(current, id));
  }, []);

  const transform = useCallback(
    (id: string, change: (placement: Placement, layer: MovableLayer) => Placement) => {
      setLayers((current) =>
        updateLayer(current, id, (layer) =>
          isMovable(layer)
            ? withPlacement(
                layer,
                constrainPlacement(layer, change(placementOf(layer), layer), diameter),
              )
            : layer,
        ),
      );
    },
    [diameter],
  );

  // ---- 指・マウスの操作（ポインターイベント）----

  const pointers = useRef(new Map<number, Point>());
  /** 触っている間に動かす層。触り始めに決める（途中で選びなおしても、動かす層は変えない） */
  const targetRef = useRef<string | undefined>(undefined);
  const layersRef = useRef(layers);
  layersRef.current = layers;

  /** 画面の座標を、キャンバスの中心を原点にした mm にする */
  const toMm = useCallback(
    (event: { clientX: number; clientY: number }): Point => {
      const rect = frameRef.current?.getBoundingClientRect();
      if (!rect || rect.width === 0) return { x: 0, y: 0 };
      const size = Math.min(rect.width, MAX_DISPLAY_PX);
      return {
        x: ((event.clientX - rect.left) / size) * diameter - diameter / 2,
        y: ((event.clientY - rect.top) / size) * diameter - diameter / 2,
      };
    },
    [diameter],
  );

  const penMode = tab === "pen";
  /** いま描いている線の ID（ペンのとき） */
  const drawingRef = useRef<string | undefined>(undefined);

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    const point = toMm(event);
    if (penMode) {
      // ペンは、1 本の指だけで描く（2 本目の指は無視する）
      if (pointers.current.size > 0) return;
      const stroke = newStrokeLayer(penColor, penWidth, point);
      drawingRef.current = stroke.id;
      event.currentTarget.setPointerCapture(event.pointerId);
      pointers.current.set(event.pointerId, point);
      setRedoStack([]);
      setLayers((current) => addStroke(current, stroke));
      return;
    }
    if (pointers.current.size === 0) {
      // 触り始め：触った場所にある層を選ぶ。何もなければ、写真
      const hit = hitTest(layersRef.current, point, extentOf);
      const hasImage = layersRef.current.some((layer) => layer.type === "image");
      const id = hit ? layerId(hit) : hasImage ? IMAGE_ID : undefined;
      targetRef.current = id;
      if (id !== undefined) select(id);
    }
    if (targetRef.current === undefined) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    pointers.current.set(event.pointerId, point);
  };

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const before = pointers.current.get(event.pointerId);
    if (penMode) {
      const drawing = drawingRef.current;
      if (!before || drawing === undefined) return;
      const after = toMm(event);
      pointers.current.set(event.pointerId, after);
      setLayers((current) => appendStrokePoint(current, drawing, after));
      return;
    }
    const target = targetRef.current;
    if (!before || target === undefined) return;
    const after = toMm(event);
    const others = [...pointers.current.entries()].filter(([id]) => id !== event.pointerId);
    pointers.current.set(event.pointerId, after);
    const other = others[0]?.[1];
    transform(target, (placement) =>
      other
        ? applyPinch(placement, [before, other], [after, other])
        : applyDrag(placement, before, after),
    );
  };

  const onPointerEnd = (event: React.PointerEvent<HTMLDivElement>) => {
    pointers.current.delete(event.pointerId);
    if (pointers.current.size === 0) drawingRef.current = undefined;
  };

  // マウスのホイールで、ポインターの位置を中心に拡大・縮小する。ページのスクロールは止める
  // （React の onWheel は、ページのスクロールを止められないため、直接登録する）
  useEffect(() => {
    const frame = frameRef.current;
    if (!frame || activeId === undefined || penMode) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const about = toMm(event);
      const factor = Math.exp(-event.deltaY * 0.0015);
      transform(activeId, (placement) => applyZoom(placement, about, factor));
    };
    frame.addEventListener("wheel", onWheel, { passive: false });
    return () => frame.removeEventListener("wheel", onWheel);
  }, [activeId, penMode, toMm, transform]);

  // ---- ボタン ----

  /** 写真は、キャンバスの中心を軸に。文字とスタンプは、自分の中心を軸に拡大・回転する */
  const aboutOf = (placement: Placement, layer: MovableLayer): Point =>
    layer.type === "image" ? CENTER : { x: placement.x, y: placement.y };

  const zoomBy = (factor: number) => {
    if (activeId === undefined) return;
    transform(activeId, (placement, layer) =>
      applyZoom(placement, aboutOf(placement, layer), factor),
    );
  };
  const rotateBy = (degrees: number) => {
    if (activeId === undefined) return;
    transform(activeId, (placement, layer) =>
      applyRotation(placement, aboutOf(placement, layer), degrees),
    );
  };
  const resetActive = () => {
    if (activeId === undefined || !active) return;
    transform(activeId, (placement, layer) =>
      layer.type === "image" && loaded
        ? fit(loaded.aspect)
        : { ...placement, x: 0, y: 0, rotationDeg: 0 },
    );
  };

  const choosePhoto = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    // 同じファイルをもう一度選んでも反応するよう、選んだあとに空にする
    event.target.value = "";
    if (file) void accept(file);
  };

  const addText = () => {
    const text = draft.text.trim();
    if (text === "") return;
    const layer = newTextLayer(text, { fontId: draft.fontId, color: draft.color });
    setLayers((current) => addDecorLayer(current, layer));
    setSelectedId(layer.id);
    setDraft((current) => ({ ...current, text: "" }));
  };

  const addSticker = (stickerId: string) => {
    const layer = newStickerLayer(stickerId, { color: stickerColor });
    setLayers((current) => addDecorLayer(current, layer));
    setSelectedId(layer.id);
  };

  const changeText = (patch: { text?: string; fontId?: string; color?: string }) => {
    if (active?.type !== "text") return;
    setLayers((current) =>
      updateLayer(current, active.id, (layer) =>
        layer.type === "text" ? { ...layer, ...patch } : layer,
      ),
    );
  };

  const changeStickerColor = (color: string) => {
    setStickerColor(color);
    if (active?.type !== "sticker") return;
    setLayers((current) =>
      updateLayer(current, active.id, (layer) =>
        layer.type === "sticker" ? { ...layer, color } : layer,
      ),
    );
  };

  const setFilter = (change: (previous: Filter | undefined) => Filter) =>
    setLayers((current) =>
      updateLayer(current, IMAGE_ID, (layer) =>
        layer.type === "image" ? { ...layer, filter: change(layer.filter) } : layer,
      ),
    );

  // ---- ペン ----

  const undoDrawing = () => {
    const result = undoStroke(layersRef.current);
    const removed = result.removed;
    if (!removed) return;
    setLayers(result.layers);
    setRedoStack((current) => [...current, removed].slice(-MAX_REDO));
  };

  const redoDrawing = () => {
    const stroke = redoStack[redoStack.length - 1];
    if (!stroke) return;
    setRedoStack((current) => current.slice(0, -1));
    setLayers((current) => addStroke(current, stroke));
  };

  const clearDrawing = () => {
    setLayers((current) => clearStrokes(current));
    setRedoStack([]);
  };

  // ---- 途中保存（ブラウザ内）----

  // 開いたとき、前回の続きがあれば、読み戻す（initialData / initialImage があるときは、そちらを使う）
  // biome-ignore lint/correctness/useExhaustiveDependencies: 開いたときに 1 回だけ調べる
  useEffect(() => {
    if (draftReady || !draftKey) return;
    let cancelled = false;
    void loadDraft(draftKey).then(async (saved) => {
      const state = saved ? parseEditorState(saved.editorData) : undefined;
      if (cancelled) return;
      if (saved && state) {
        setBackground(state.background.color);
        setLayers(state.layers.filter((layer) => layer.type !== "image"));
        const savedImage = state.layers.find(
          (layer): layer is ImageLayer => layer.type === "image",
        );
        await accept(saved.image, savedImage);
        if (!cancelled) setResumed(true);
      }
      if (!cancelled) setDraftReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, [draftKey]);

  // 変えるたびに、少し待ってから、まとめて保存する（写真があるときだけ。写真がないと、続きにならない）
  useEffect(() => {
    if (!draftKey || !draftReady || !loaded) return;
    const timer = setTimeout(() => {
      void saveDraft(draftKey, {
        savedAt: Date.now(),
        editorData: {
          ...createEmptyState(spec),
          background: { color: background },
          layers: pruneEmptyText(layers),
        },
        image: loaded.image.blob,
      });
    }, DRAFT_SAVE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [draftKey, draftReady, loaded, layers, background, spec]);

  /** はじめからやり直す。押しまちがいで消さないよう、2 回押してもらう */
  const resetAll = () => {
    if (!confirmingReset) {
      setConfirmingReset(true);
      setTimeout(() => setConfirmingReset(false), RESET_CONFIRM_MS);
      return;
    }
    setConfirmingReset(false);
    setLayers([]);
    setLoaded(undefined);
    setBackground(DEFAULT_BACKGROUND);
    setSelectedId(undefined);
    setRedoStack([]);
    setResumed(false);
    setMessage(undefined);
    if (draftKey) void clearDraft(draftKey);
  };

  const removeActive = () => {
    if (!active || !isDecor(active)) return;
    setLayers((current) => removeLayer(current, active.id));
    setSelectedId(IMAGE_ID);
  };

  const confirm = async () => {
    const stage = stageRef.current;
    if (!stage || !loaded || !imageLayer) return;
    setBusy(true);
    setMessage(undefined);
    // ガイド線と選択の枠は、印刷に入れない。出力の間だけ隠す
    const guides = guidesRef.current;
    guides?.visible(false);
    try {
      const outputPx = mmToPx(diameter, spec.dpi);
      const png = await stage.toBlob({
        pixelRatio: outputPx / displayPx,
        mimeType: "image/png",
      });
      if (!(png instanceof Blob)) throw new Error("画像を作れませんでした");
      const base = createEmptyState(spec);
      onExport({
        png,
        editorData: {
          ...base,
          background: { color: background },
          layers: pruneEmptyText(layers),
        },
      });
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "画像を作れませんでした");
    } finally {
      guides?.visible(true);
      setBusy(false);
    }
  };

  // ---- 描画 ----

  // ガイドの色は、トークン（CSS 変数）から取る。読み込めない場合の色は、見えることだけが目的の予備
  const colors = useMemo(
    () => ({
      dim: resolveColor("--color-ink", "#222222"),
      cut: resolveColor("--color-accent", "#e0604a"),
      safe: resolveColor("--color-paper", "#f5f2ef"),
    }),
    [],
  );

  const lineWidth = 2 / scale;
  // 写真が、印刷される範囲（塗り足しを含む円）を覆っていないと、その部分は、背景の色のまま印刷される
  const uncovered =
    imageLayer && loaded
      ? !coversCircle(placementOf(imageLayer), loaded.aspect, diameter / 2)
      : false;
  const coarse =
    imageLayer && loaded
      ? effectiveDpi(loaded.image.width, imageLayer.widthMm) < MIN_RECOMMENDED_DPI
      : false;

  const selectedDecor = active && isDecor(active) && !penMode ? active : undefined;
  const hasStrokes = layers.some(isStroke);
  const selectedExtent = selectedDecor ? extentOf(selectedDecor) : undefined;
  const canExport = Boolean(imageLayer) && !busy;
  const disabledTools = activeId === undefined;

  return (
    <section className="cb-editor" aria-label="バッジのデザイン">
      <div
        ref={frameRef}
        className="cb-editor__frame"
        style={{ maxWidth: MAX_DISPLAY_PX, height: displayPx }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerEnd}
        onPointerCancel={onPointerEnd}
        role="img"
        aria-label={
          loaded
            ? "バッジのデザイン。指でドラッグして動かし、2 本の指で拡大・回転できます"
            : "写真を選ぶと、ここに表示されます"
        }
      >
        <Stage ref={stageRef} width={displayPx} height={displayPx} scaleX={scale} scaleY={scale}>
          <KonvaLayer listening={false}>
            <Rect x={0} y={0} width={diameter} height={diameter} fill={background} />
            <Group x={diameter / 2} y={diameter / 2}>
              <LayerNodes layers={layers} imageSource={imageSource} fontsVersion={fontsVersion} />
            </Group>
          </KonvaLayer>
          <KonvaLayer ref={guidesRef} listening={false}>
            <Group x={diameter / 2} y={diameter / 2}>
              {/* 見える円（切り取り線）の外側を暗くする。塗り足しは、缶の裏に折り込まれる部分 */}
              <Shape
                sceneFunc={(context, shape) => {
                  context.beginPath();
                  context.rect(-diameter / 2, -diameter / 2, diameter, diameter);
                  context.arc(0, 0, cutRadius, 0, Math.PI * 2, true);
                  context.closePath();
                  context.fillShape(shape);
                }}
                fill={colors.dim}
                opacity={0.5}
              />
              {/* 印刷される範囲の端。ここまで、写真がないと、端が白く出る */}
              <Circle
                radius={diameter / 2}
                stroke={colors.safe}
                strokeWidth={lineWidth * 0.6}
                opacity={0.6}
              />
              <Circle radius={cutRadius} stroke={colors.cut} strokeWidth={lineWidth} />
              <Circle
                radius={safeRadius}
                stroke={colors.safe}
                strokeWidth={lineWidth}
                dash={[lineWidth * 3, lineWidth * 3]}
              />
              {/* 選んでいる文字・スタンプの枠（出力には入らない） */}
              {selectedDecor && selectedExtent && (
                <Group
                  x={selectedDecor.xMm}
                  y={selectedDecor.yMm}
                  rotation={selectedDecor.rotationDeg}
                >
                  <Rect
                    x={-selectedExtent.halfWidthMm}
                    y={-selectedExtent.halfHeightMm}
                    width={selectedExtent.halfWidthMm * 2}
                    height={selectedExtent.halfHeightMm * 2}
                    stroke={colors.cut}
                    strokeWidth={lineWidth}
                    dash={[lineWidth * 2, lineWidth * 2]}
                  />
                </Group>
              )}
            </Group>
          </KonvaLayer>
        </Stage>
      </div>

      <details className="cb-editor__help">
        <summary>線の見かた</summary>
        <ul className="cb-muted cb-editor__legend">
          <li>
            <span className="cb-editor__key" aria-hidden="true" />
            バッジの縁（外側は、缶の裏に折り込まれます）
          </li>
          <li>
            <span className="cb-editor__key cb-editor__key--safe" aria-hidden="true" />
            文字や顔は、この内側に
          </li>
          <li>
            <span className="cb-editor__key cb-editor__key--print" aria-hidden="true" />
            印刷される範囲の端（ここまで写真があると、端が白くなりません）
          </li>
        </ul>
      </details>

      {message && <Notice tone="error">{message}</Notice>}
      {resumed && <Notice>前回の続きから再開しました。</Notice>}
      {uncovered && (
        <Notice>
          写真が、印刷される範囲（薄い線の円）を覆っていません。端に白い部分が出ます。拡大するか、「位置を戻す」を押してください。
        </Notice>
      )}
      {coarse && (
        <Notice>
          この写真は小さいため、印刷すると粗く見えることがあります。小さくするか、別の写真にしてください。
        </Notice>
      )}

      {/* 選んでいる層（写真・文字・スタンプ）を動かす */}
      <fieldset className="cb-editor__tools">
        <legend className="cb-editor__visually-hidden">選んだものを動かす</legend>
        <Button variant="line" onClick={() => zoomBy(ZOOM_STEP)} disabled={disabledTools}>
          拡大
        </Button>
        <Button variant="line" onClick={() => zoomBy(1 / ZOOM_STEP)} disabled={disabledTools}>
          縮小
        </Button>
        <Button variant="line" onClick={() => rotateBy(-ROTATE_STEP_DEG)} disabled={disabledTools}>
          左に回す
        </Button>
        <Button variant="line" onClick={() => rotateBy(ROTATE_STEP_DEG)} disabled={disabledTools}>
          右に回す
        </Button>
        <Button variant="line" onClick={resetActive} disabled={disabledTools}>
          位置を戻す
        </Button>
        <Button
          variant="line"
          onClick={() => select(nextLayerId(layers, activeId))}
          disabled={layers.filter(isMovable).length < 2}
        >
          次を選ぶ
        </Button>
        {selectedDecor && (
          <>
            <Button
              variant="line"
              onClick={() => setLayers((current) => bringToFront(current, selectedDecor.id))}
            >
              手前に出す
            </Button>
            <Button variant="line" onClick={removeActive}>
              消す
            </Button>
          </>
        )}
      </fieldset>

      <div className="cb-editor__tabs" role="tablist" aria-label="道具">
        {TABS.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={tab === item.id}
            className="cb-editor__tab"
            onClick={() => setTab(item.id)}
          >
            {item.label}
          </button>
        ))}
      </div>

      <div role="tabpanel">
        {tab === "photo" && (
          <div className="cb-editor__panel">
            <label className="cb-button cb-button--line cb-editor__choose">
              {loaded ? "写真を選びなおす" : "写真を選ぶ"}
              <input
                type="file"
                accept="image/*"
                className="cb-editor__file"
                onChange={choosePhoto}
              />
            </label>
            <p className="cb-muted">
              1 本の指でドラッグすると動き、2
              本の指で拡大・回転できます。文字やスタンプは、触って選びます。
            </p>
            {(loaded || layers.length > 0) && (
              <Button variant="line" onClick={resetAll}>
                {confirmingReset ? "もう一度押すと、全部消えます" : "はじめからやり直す"}
              </Button>
            )}
          </div>
        )}
        {tab === "text" && (
          <TextPanel
            selected={active?.type === "text" ? active : undefined}
            draft={draft}
            onDraft={(patch) => setDraft((current) => ({ ...current, ...patch }))}
            onChangeSelected={changeText}
            onAdd={addText}
          />
        )}
        {tab === "sticker" && (
          <StickerPanel
            selected={active?.type === "sticker" ? active : undefined}
            color={stickerColor}
            onColor={changeStickerColor}
            onAdd={addSticker}
          />
        )}
        {tab === "pen" && (
          <PenPanel
            color={penColor}
            onColor={setPenColor}
            widthMm={penWidth}
            onWidth={setPenWidth}
            canUndo={hasStrokes}
            canRedo={redoStack.length > 0}
            hasStrokes={hasStrokes}
            onUndo={undoDrawing}
            onRedo={redoDrawing}
            onClear={clearDrawing}
          />
        )}
        {tab === "background" && <BackgroundPanel color={background} onColor={setBackground} />}
        {tab === "filter" && (
          <FilterPanel
            filter={filter}
            disabled={!imageLayer}
            onType={(type) =>
              setFilter((previous) => ({
                type,
                strength: previous?.strength ?? DEFAULT_STRENGTH,
              }))
            }
            onStrength={(strength) =>
              setFilter((previous) => ({ type: previous?.type ?? "none", strength }))
            }
          />
        )}
      </div>

      <Button size="large" block onClick={() => void confirm()} disabled={!canExport}>
        {busy ? "作っています…" : confirmLabel}
      </Button>
    </section>
  );
}
