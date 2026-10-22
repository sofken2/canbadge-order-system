import { type BadgeSpec, mmToPx, printDiameterMm, safeDiameterMm } from "@canbadge/badge-spec";
import { Button, ConfirmDialog, Notice } from "@canbadge/ui";
import type Konva from "konva";
import {
  type ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Circle, Group, Layer as KonvaLayer, Line, Rect, Shape, Stage } from "react-konva";
import { hasColorAdjust } from "./color-adjust";
import { resolveColor } from "./css-color";
import { clearDraft, DRAFT_CLEAR_EVENT, loadDraft, saveDraft } from "./draft-store";
import { DEFAULT_STRENGTH, hasFilter } from "./filter-params";
import { applyFilter } from "./filters";
import { ensureFontStylesheet, findFont, loadFontFor } from "./fonts";
import {
  applyDrag,
  applyHandleRotation,
  applyHandleScale,
  applyPinch,
  applyRotation,
  applyZoom,
  coversCircle,
  type Handle,
  handleAt,
  type Placement,
  type Point,
} from "./gesture";
import { containWidthMm, coverWidthMm, effectiveDpi } from "./image-size";
import { LayerNodes } from "./LayerNodes";
import { LazyBadgePreview3D } from "./LazyBadgePreview3D";
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
  TEXT_OUTLINE_RATIO,
  undoStroke,
  updateLayer,
  withPlacement,
} from "./layers";
import { type LoadedImage, loadImage } from "./load-image";
import {
  type ColorAdjust,
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
import {
  CenterIcon,
  FrontIcon,
  NextIcon,
  ResetIcon,
  RotateLeftIcon,
  RotateRightIcon,
  TrashIcon,
  ZoomInIcon,
  ZoomOutIcon,
} from "./ToolIcons";
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
   * 指定すると、写真を、この一辺（mm）の正方形に収めて置く（切れない）。指定しなければ、印刷範囲を覆うように置く。
   * Discord のアイコンは、70mm いっぱいに伸ばすと端が切れるので、これで小さめに置く
   */
  imageFitMm?: number;
  /**
   * 途中保存の名前。指定すると、作りかけのデザインと写真を、この端末のブラウザ（IndexedDB）に自動で残し、
   * 次に開いたとき、続きから再開する（24 時間まで）。initialData / initialImage があるときは、そちらを使う。
   * 注文が済んだら、呼ぶ側が clearDraft(draftKey) で消す
   */
  draftKey?: string;
  /**
   * 途中保存が変わったときに呼ぶ。保存した時点のデザインの絵（preview）か、消したとき（やり直し）は undefined。
   * 閉じる直前の変更も、閉じたあとに保存して、ここで知らせる。エディタの外で、今のデザインを見せるのに使う。
   * saved は、ブラウザに書けたか（書けない端末では false。そのときは DRAFT_CHANGE_EVENT も来ない）
   */
  onDraftChange?: (preview: Blob | undefined, saved: boolean) => void;
  confirmLabel?: string;
  /**
   * 「3D で完成予想を見る」を出すか。はじめの画面の「写真をはめてみる」は、画面に本物の 3D があるので出さない
   */
  preview3dEnabled?: boolean;
  /**
   * true にすると、途中保存の続き（写真あり）を読み終えたら、自動で決定（onExport）まで進む。
   * デザインがもう決まっていて、編集を見せたくないとき（はじめの画面の「注文の確認へ進む」から来たとき）に使う。
   * 端に背景色が出るデザインでも、警告で止めずに進む（警告は、編集画面で決定したときに出している）
   */
  exportWhenReady?: boolean;
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
/** 選んだ文字・スタンプのつまみの大きさ（CSS px）。描く大きさと、指で押せる広さ（当たり）、回転のつまみの離れ */
const HANDLE_PX = 10;
const HANDLE_HIT_PX = 22;
const ROTATE_HANDLE_OFFSET_PX = 26;
/** 元に戻す（Ctrl+Z）で、ひとまとめにする時間（ms）。ドラッグやスライダーの細かい変化を、手を止めるまで 1 回分にする */
const HISTORY_GROUP_MS = 500;
/** 元に戻せる回数の上限。多すぎると、メモリを使う */
const MAX_HISTORY = 50;
/** PC の大きさのスライダーの幅（基準の 2 の何乗まで）。2 なら 1/4〜4 倍 */
const ZOOM_SLIDER_MAX = 2;
/** フィルターの強さを動かしている間、写真を作り直すのを待つ時間（ms） */
const FILTER_DELAY_MS = 120;

type Loaded = { image: LoadedImage; aspect: number };
// 写真は、タブではなく、キャンバスの左上の「画像を選ぶ・変える」で扱う
type Tab = "background" | "text" | "sticker" | "pen" | "filter";

const TABS: readonly { id: Tab; label: string }[] = [
  { id: "background", label: "背景" },
  { id: "text", label: "文字" },
  { id: "sticker", label: "スタンプ" },
  { id: "pen", label: "ペン" },
  { id: "filter", label: "効果" },
];

const CENTER: Point = { x: 0, y: 0 };
const extentOf = (layer: MovableLayer) => extentOfLayer(layer, measureTextEm);
/** 描き直しの「やり直す」で戻せる線の数。多すぎると、メモリを使う */
const MAX_REDO = 50;
/** 覆っているか・粗いかの判定を、動きが止まってから変えるまでの待ち（ms） */
const SETTLE_MS = 500;
/** 「前回の続きから再開しました」を出しておく時間（ms） */
const RESUMED_NOTICE_MS = 4000;
/** 「はじめに戻す」を、もう一度押すまでの猶予（ms）。押しまちがいで、作りかけを消さないため */
const RESET_CONFIRM_MS = 4000;
/** 3D のプレビュー用の PNG の一辺（px）。軽くするため、印刷の出力より小さくする */
const PREVIEW3D_PX = 768;
/** 3D を開いている間、デザインを変えてから作り直すまでの待ち（ms）。動かしている最中は作らない */
const PREVIEW3D_REFRESH_MS = 400;
/** キャンバスを PNG にする */
function canvasToPng(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (png) => (png ? resolve(png) : reject(new Error("画像を作れませんでした"))),
      "image/png",
    );
  });
}

/** 途中保存に添える絵の一辺（px）。はじめの画面の 3D に貼るだけなので、3D のプレビューと同じでよい */
const DRAFT_PREVIEW_PX = PREVIEW3D_PX;

export function BadgeEditor({
  spec,
  initialData,
  initialImage,
  imageFitMm,
  draftKey,
  onDraftChange,
  confirmLabel = "これで決定",
  preview3dEnabled = true,
  exportWhenReady = false,
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
  const [tab, setTab] = useState<Tab>("background");
  const [draft, setDraft] = useState<TextDraft>({
    text: "",
    fontId: "maru",
    color: INK,
    outlineColor: "",
    outlineWidth: TEXT_OUTLINE_RATIO,
  });
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
  /** キャンバスを一度でも触ったか。触るまでは、キャンバスの上に、直接動かせることを案内する */
  const [touched, setTouched] = useState(false);
  const [confirmingReset, setConfirmingReset] = useState(false);
  const resetRef = useRef<HTMLButtonElement>(null);
  // 1 回押したあと、ゴミ箱以外を触ったら・少したったら、確認をやめる（もう一度 2 回押さないと消えない）。
  // 確認しているあいだだけ、時間切れと、よそを触ったことを見張る
  useEffect(() => {
    if (!confirmingReset) return;
    const cancel = () => setConfirmingReset(false);
    const timer = setTimeout(cancel, RESET_CONFIRM_MS);
    const onPointerDown = (event: PointerEvent) => {
      if (!(event.target instanceof Node) || !resetRef.current?.contains(event.target)) cancel();
    };
    // キャンバスは、触ったときの伝わりを止めるので、先に受け取る（capture）
    document.addEventListener("pointerdown", onPointerDown, true);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("pointerdown", onPointerDown, true);
    };
  }, [confirmingReset]);
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
    // 非表示や、ダイアログが開く途中は、幅が 0 と測れる。0 にすると、倍率が 0 になり、
    // 線の太さ（2 / scale）が Infinity になるので、そのあいだは、前の大きさのままにする
    const update = () => {
      const width = Math.floor(frame.clientWidth);
      if (width > 0) setDisplayPx(Math.min(MAX_DISPLAY_PX, width));
    };
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
      widthMm:
        imageFitMm === undefined
          ? coverWidthMm(diameter, aspect)
          : containWidthMm(imageFitMm, aspect),
      rotationDeg: 0,
    }),
    [diameter, imageFitMm],
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
            adjust: keep?.adjust ?? previous?.adjust,
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
  const adjust = imageLayer?.adjust;
  const adjustSkin = adjust?.skin;
  const adjustSaturation = adjust?.saturation;
  // biome-ignore lint/correctness/useExhaustiveDependencies: filter と adjust の中身が変わったときだけ作り直す
  useEffect(() => {
    if (!loaded) {
      setImageSource(undefined);
      return;
    }
    const timer = setTimeout(
      () => setImageSource(applyFilter(loaded.image.canvas, filter, adjust)),
      hasFilter(filter) || hasColorAdjust(adjust) ? FILTER_DELAY_MS : 0,
    );
    return () => clearTimeout(timer);
  }, [loaded, filterType, filterStrength, adjustSkin, adjustSaturation]);

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
  /** 選んだ文字・スタンプのつまみを、つかんでいるとき（大きさか回転か） */
  const handleRef = useRef<Handle | undefined>(undefined);
  /** 触った点が、選んでいる文字・スタンプのつまみなら、その層とつまみ（描くたびに、下で新しくする） */
  const grabHandleRef = useRef<(point: Point) => { id: string; handle: Handle } | undefined>(
    () => undefined,
  );
  const grabHandle = (point: Point) => grabHandleRef.current(point);

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
      // 触り始め：選んでいる文字・スタンプのつまみなら、それをつかむ（大きさ・回転）
      const grabbed = grabHandle(point);
      if (grabbed) {
        handleRef.current = grabbed.handle;
        targetRef.current = grabbed.id;
        event.currentTarget.setPointerCapture(event.pointerId);
        pointers.current.set(event.pointerId, point);
        return;
      }
      handleRef.current = undefined;
      // 触った場所にある層を選ぶ。何もなければ、写真
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
    // つまみ：その文字・スタンプの中心を軸に、大きさ・回転を変える
    const handle = handleRef.current;
    if (handle) {
      pointers.current.set(event.pointerId, after);
      transform(target, (placement) => {
        const about = { x: placement.x, y: placement.y };
        return handle === "scale"
          ? applyHandleScale(placement, about, before, after)
          : applyHandleRotation(placement, about, before, after);
      });
      return;
    }
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
    if (pointers.current.size === 0) {
      drawingRef.current = undefined;
      handleRef.current = undefined;
    }
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
  /** 選んでいるものを、バッジの真ん中に置く（大きさと回転は、そのまま） */
  const centerActive = () => {
    if (activeId === undefined) return;
    transform(activeId, (placement) => ({ ...placement, x: 0, y: 0 }));
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

  const addText = (text: string) => {
    if (text.trim() === "") return;
    const layer = newTextLayer(text, {
      fontId: draft.fontId,
      color: draft.color,
      outlineColor: draft.outlineColor,
      outlineWidth: draft.outlineWidth,
    });
    setLayers((current) => addDecorLayer(current, layer));
    setSelectedId(layer.id);
    setDraft((current) => ({ ...current, text: "" }));
  };

  const addSticker = (stickerId: string) => {
    const layer = newStickerLayer(stickerId, { color: stickerColor });
    setLayers((current) => addDecorLayer(current, layer));
    setSelectedId(layer.id);
  };

  const changeText = (patch: Partial<TextDraft>) => {
    if (active?.type !== "text") return;
    setLayers((current) =>
      updateLayer(current, active.id, (layer) => {
        if (layer.type !== "text") return layer;
        const { outlineColor, ...rest } = patch;
        const next = { ...layer, ...rest };
        if (outlineColor === undefined) return next;
        // ふちの色を空文字（なし）にしたら、項目ごと消す（保存の形を、ふちなしの文字と同じにする）
        if (outlineColor === "") {
          const { outlineColor: _removed, outlineWidth: _width, ...withoutOutline } = next;
          return withoutOutline;
        }
        return { ...next, outlineColor };
      }),
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

  const changeAdjust = (change: Partial<ColorAdjust>) =>
    setLayers((current) =>
      updateLayer(current, IMAGE_ID, (layer) =>
        layer.type === "image"
          ? { ...layer, adjust: { skin: 0, saturation: 0, ...layer.adjust, ...change } }
          : layer,
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
  /** 「描いたものを全部消す」の確認を出しているか。押しまちがいで消えないよう、モーダルで確かめてから消す */
  const [confirmingClear, setConfirmingClear] = useState(false);

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
        // 絵は、見えないときの保存で使い回す（下の保存のところ）
        lastPreviewRef.current = saved.preview;
        await accept(saved.image, savedImage);
        if (!cancelled) setResumed(true);
      }
      if (!cancelled) setDraftReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, [draftKey]);

  // 呼ぶ側の関数は、描くたびに変わることがあるので、保存の予約（effect）の依存に入れず、最新を ref で持つ
  const onDraftChangeRef = useRef(onDraftChange);
  onDraftChangeRef.current = onDraftChange;
  /**
   * 今の中身を保存する関数（いちばん新しいもの）。閉じるときは、変更がなくても、これで必ず書く。
   * 書き終わりを onDraftChange で知らせるので、呼ぶ側は「閉じたあと、保存が済んでから」次へ進める
   */
  const pendingSaveRef = useRef<(() => void) | undefined>(undefined);
  /** いちばん新しい絵（途中保存に添える）。見えないときの保存で、使い回す */
  const lastPreviewRef = useRef<Blob | undefined>(undefined);

  // 変えるたびに、少し待ってから、まとめて保存する（写真があるときだけ。写真がないと、続きにならない）
  // biome-ignore lint/correctness/useExhaustiveDependencies: renderCanvas は描くたびに作り直す関数。保存の中身（layers など）が変わったときだけ予約し直す
  useEffect(() => {
    if (!draftKey || !draftReady || !loaded) return;
    const save = () => {
      // 絵は、ここで（同期で）描いておく。閉じる途中でも、キャンバスが残っているうちに描けるように
      // エディタが見えていないとき（注文の確認中など、隠してあるとき）は、キャンバスから正しい絵を作れない。
      // そのときは、前に作った絵を使い回す（絵なしで保存すると、はじめの画面の 3D が、編集の中身とずれる）
      let canvas: HTMLCanvasElement | undefined;
      if (frameRef.current?.getClientRects().length) {
        try {
          canvas = renderCanvas(DRAFT_PREVIEW_PX);
        } catch {
          canvas = undefined;
        }
      }
      void (async () => {
        const rendered = canvas ? await canvasToPng(canvas).catch(() => undefined) : undefined;
        if (rendered) lastPreviewRef.current = rendered;
        const preview = rendered ?? lastPreviewRef.current;
        const saved = await saveDraft(draftKey, {
          savedAt: Date.now(),
          editorData: {
            ...createEmptyState(spec),
            background: { color: background },
            layers: pruneEmptyText(layers),
          },
          image: loaded.image.blob,
          preview,
        });
        onDraftChangeRef.current?.(preview, saved);
      })();
    };
    pendingSaveRef.current = save;
    // 待つ間に、作りかけが消されたら（pendingSaveRef が外れたら）、書かない
    const timer = setTimeout(() => {
      if (pendingSaveRef.current === save) save();
    }, DRAFT_SAVE_DELAY_MS);
    return () => {
      clearTimeout(timer);
      if (pendingSaveRef.current === save) pendingSaveRef.current = undefined;
    };
  }, [draftKey, draftReady, loaded, layers, background, spec]);

  // 呼ぶ側が作りかけを消したら（注文・投稿が済んだとき）、予約していた保存を取りやめる。
  // 次に中身を変えたときは、また保存する（上の effect が予約し直す）
  useEffect(() => {
    if (!draftKey) return undefined;
    const onClear = (event: Event) => {
      if ((event as CustomEvent<string>).detail === draftKey) pendingSaveRef.current = undefined;
    };
    window.addEventListener(DRAFT_CLEAR_EVENT, onClear);
    return () => window.removeEventListener(DRAFT_CLEAR_EVENT, onClear);
  }, [draftKey]);

  // 閉じるとき、すぐ書く（閉じる直前の変更を失わない。書き終わりを、呼ぶ側に知らせる）。
  // 子のキャンバス（Stage）が壊される前に描きたいので、親であるここの layout effect の後始末で行う
  useLayoutEffect(
    () => () => {
      pendingSaveRef.current?.();
    },
    [],
  );

  // 「前回の続きから再開しました」は、伝われば十分なので、少したったら消す（操作の邪魔にしない）
  useEffect(() => {
    if (!resumed) return;
    const timer = setTimeout(() => setResumed(false), RESUMED_NOTICE_MS);
    return () => clearTimeout(timer);
  }, [resumed]);

  /** はじめに戻す。押しまちがいで消さないよう、2 回押してもらう */
  const resetAll = () => {
    if (!confirmingReset) {
      setConfirmingReset(true);
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
    if (draftKey) {
      pendingSaveRef.current = undefined;
      void clearDraft(draftKey).then(() => onDraftChangeRef.current?.(undefined, true));
    }
  };

  const removeActive = () => {
    if (!active || !isDecor(active)) return;
    setLayers((current) => removeLayer(current, active.id));
    setSelectedId(IMAGE_ID);
  };

  // ---- 元に戻す・やり直す（PC の Ctrl+Z / ⌘Z）----
  // 文字・スタンプ・写真の置き方と背景を、変わるたびに履歴に残す。細かく続く変化（ドラッグ・スライダー）は、
  // 手を止めるまで（HISTORY_GROUP_MS）を 1 回分にまとめる。開いたときの読み込み（ready になる前）は、残さない
  type Snapshot = { layers: Layer[]; background: string };
  const historyRef = useRef<{
    past: Snapshot[];
    future: Snapshot[];
    /** いまの中身（次に変わったとき、変わる前として past に積む） */
    last: Snapshot | undefined;
    /** 戻す・やり直すで変えたとき。その変化は、履歴に積まない */
    restoring: boolean;
    /**
     * 見せてから（ready のあと）の中身を last に持っているか。ready になった描画では、読み込み前の中身を
     * 積まずに、いまの中身を last にするだけにする（積むと、最初の Ctrl+Z で写真が消える）
     */
    primed: boolean;
    groupTimer: ReturnType<typeof setTimeout> | undefined;
  }>({
    past: [],
    future: [],
    last: undefined,
    restoring: false,
    primed: false,
    groupTimer: undefined,
  });

  const restore = (snapshot: Snapshot) => {
    const history = historyRef.current;
    history.restoring = true;
    if (history.groupTimer) clearTimeout(history.groupTimer);
    history.groupTimer = undefined;
    setLayers(snapshot.layers);
    setBackground(snapshot.background);
    setSelectedId(IMAGE_ID);
  };
  const undo = () => {
    const history = historyRef.current;
    const previous = history.past.pop();
    if (!previous || !history.last) return;
    history.future.push(history.last);
    restore(previous);
  };
  const redo = () => {
    const history = historyRef.current;
    const next = history.future.pop();
    if (!next || !history.last) return;
    history.past.push(history.last);
    restore(next);
  };

  // PC：選んでいる文字・スタンプを、Delete（Mac は delete＝Backspace）キーで消す。Ctrl+Z（⌘Z）で戻し、
  // Ctrl+Shift+Z（⌘⇧Z）・Ctrl+Y でやり直す。文字を打っている最中（入力欄）は、入力欄の元に戻すに任せる。
  // エディタが隠れているとき（注文の確認中など）は、何もしない
  const keyActionsRef = useRef({ removeActive, undo, redo });
  keyActionsRef.current = { removeActive, undo, redo };
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();
      const command = event.ctrlKey || event.metaKey;
      const isDelete = key === "delete" || key === "backspace";
      const isUndo = command && key === "z" && !event.shiftKey;
      const isRedo = command && ((key === "z" && event.shiftKey) || key === "y");
      if (!isDelete && !isUndo && !isRedo) return;
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        (target.isContentEditable || target.closest("input, textarea, select"))
      )
        return;
      // 隠れている（親に hidden がある）と、枠の大きさが 0 になる
      if (!frameRef.current?.getClientRects().length) return;
      event.preventDefault();
      if (isDelete) keyActionsRef.current.removeActive();
      else if (isUndo) keyActionsRef.current.undo();
      else keyActionsRef.current.redo();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  /**
   * 一辺 outputPx のキャンバスに描く。ガイド線と選択の枠は、印刷に入れないので、描く間だけ隠す。
   * 同期で描いて、すぐ戻す（隠したままの画面が、一瞬でも見えないように）
   */
  const renderCanvas = (outputPx: number): HTMLCanvasElement => {
    const stage = stageRef.current;
    if (!stage) throw new Error("画像を作れませんでした");
    const guides = guidesRef.current;
    guides?.visible(false);
    try {
      return stage.toCanvas({ pixelRatio: outputPx / displayPx });
    } finally {
      guides?.visible(true);
    }
  };

  /** 一辺 outputPx の PNG を作る */
  const renderPng = (outputPx: number) => canvasToPng(renderCanvas(outputPx));

  // ---- 3D のプレビュー ----

  const [preview3d, setPreview3d] = useState<string | undefined>(undefined);
  const [preview3dBusy, setPreview3dBusy] = useState(false);
  const preview3dRef = useRef<string | undefined>(undefined);

  const setPreviewUrl = (url: string | undefined) => {
    if (preview3dRef.current) URL.revokeObjectURL(preview3dRef.current);
    preview3dRef.current = url;
    setPreview3d(url);
  };
  // 部品を閉じるとき、作った一時的なアドレスを手放す
  useEffect(
    () => () => {
      if (preview3dRef.current) URL.revokeObjectURL(preview3dRef.current);
    },
    [],
  );

  // 押したときに、今のデザインから 1 枚作る。開いている間は、下の effect が、デザインが変わるたびに作り直す
  const showPreview3d = async () => {
    if (!loaded || !imageLayer) return;
    setPreview3dBusy(true);
    setMessage(undefined);
    try {
      setPreviewUrl(URL.createObjectURL(await renderPng(PREVIEW3D_PX)));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "画像を作れませんでした");
    } finally {
      setPreview3dBusy(false);
    }
  };
  const showPreview3dRef = useRef(showPreview3d);
  showPreview3dRef.current = showPreview3d;

  // 3D を開いている間は、デザインが変わるたびに作り直す。動かしている最中に毎回作ると重いので、手を止めてから
  const preview3dOpen = preview3d !== undefined;
  const preview3dShownRef = useRef<unknown>(undefined);
  // biome-ignore lint/correctness/useExhaustiveDependencies: 背景色は、中では読まないが、変わったら作り直す
  useEffect(() => {
    if (!preview3dOpen) {
      preview3dShownRef.current = undefined;
      return undefined;
    }
    // 開いた直後（押したときに作ったもの）は、作り直さない
    if (preview3dShownRef.current === undefined) {
      preview3dShownRef.current = layers;
      return undefined;
    }
    const timer = setTimeout(() => void showPreview3dRef.current(), PREVIEW3D_REFRESH_MS);
    return () => clearTimeout(timer);
  }, [preview3dOpen, layers, background]);

  /** 決定を押したのに、端に白い部分が出るとき。そのまま進むか、合わせるかを選んでもらう */
  const [warnUncovered, setWarnUncovered] = useState(false);

  // force：端に白い部分が出ると知ったうえで、そのまま進む
  const confirm = async (force = false) => {
    if (!loaded || !imageLayer) return;
    if (uncovered && !force) {
      setWarnUncovered(true);
      return;
    }
    setWarnUncovered(false);
    setBusy(true);
    setMessage(undefined);
    try {
      const png = await renderPng(mmToPx(diameter, spec.dpi));
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
      // つまみの中の色。写真の上でも見えるよう、白っぽい面にする
      handle: resolveColor("--color-card", "#fcfbfa"),
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
  // 動かしている最中は、覆っているか・粗いかが、行ったり来たりする。そのたびに出し入れすると、ちらつくので、
  // 手を止めてから判定を変える
  const showCoarse = useSettled(coarse, SETTLE_MS);

  /** 写真を、印刷される範囲をちょうど覆う大きさで、真ん中に置き直す */
  const coverImage = () => {
    if (!loaded) return;
    transform(IMAGE_ID, () => ({
      x: 0,
      y: 0,
      widthMm: coverWidthMm(diameter, loaded.aspect),
      rotationDeg: 0,
    }));
  };

  const selectedDecor = active && isDecor(active) && !penMode ? active : undefined;
  const hasStrokes = layers.some(isStroke);
  const selectedExtent = selectedDecor ? extentOf(selectedDecor) : undefined;
  // つまみの大きさを、画面の px から mm にする（キャンバスの拡大率 scale は、1 mm あたりの px）
  const handleMm = HANDLE_PX / scale;
  const handleHitMm = HANDLE_HIT_PX / scale;
  const rotateOffsetMm = ROTATE_HANDLE_OFFSET_PX / scale;
  grabHandleRef.current = (point) => {
    if (!selectedDecor || !selectedExtent) return undefined;
    const handle = handleAt(
      point,
      { x: selectedDecor.xMm, y: selectedDecor.yMm },
      selectedDecor.rotationDeg,
      { width: selectedExtent.halfWidthMm, height: selectedExtent.halfHeightMm },
      rotateOffsetMm,
      handleHitMm,
    );
    return handle ? { id: layerId(selectedDecor), handle } : undefined;
  };
  const canExport = Boolean(imageLayer) && !busy;
  const disabledTools = activeId === undefined;

  // ---- PC のスライダー（大きさ・回転）----
  // 大きさは、基準（写真は、円をちょうど覆う大きさ。文字・スタンプは、直径の 4 割）の 1/4〜4 倍を、
  // 倍率の対数で動かす（真ん中が基準。小さいほうも大きいほうも、同じ手ごたえで動く）。はみ出しなどの制限は、ボタンと同じ
  const activePlacement = active && isMovable(active) ? placementOf(active) : undefined;
  const zoomBase =
    active?.type === "image" && loaded ? coverWidthMm(diameter, loaded.aspect) : diameter * 0.4;
  const zoomValue = activePlacement
    ? Math.min(
        ZOOM_SLIDER_MAX,
        Math.max(-ZOOM_SLIDER_MAX, Math.log2(activePlacement.widthMm / zoomBase)),
      )
    : 0;
  const rotationValue = activePlacement
    ? ((((activePlacement.rotationDeg + 180) % 360) + 360) % 360) - 180
    : 0;
  const setZoom = (value: number) => {
    if (!activePlacement) return;
    zoomBy((zoomBase * 2 ** value) / activePlacement.widthMm);
  };
  const setRotation = (degrees: number) => {
    if (!activePlacement) return;
    rotateBy(degrees - rotationValue);
  };

  // 見せてよいか。途中保存を読み終え、最初の写真（initialImage）があれば、それも読み終えたあと。
  // 読めなかったときも、そのことを知らせるために見せる
  const ready =
    draftReady && (initialImage === undefined || loaded !== undefined || message !== undefined);

  // 写真を替えたとき・はじめに戻したときは、履歴を捨てる。履歴は写真そのもの（loaded）を持たないので、
  // 戻すと、前の写真の置き方に新しい写真が描かれたり、写真のない画像の層が戻ったりする
  // biome-ignore lint/correctness/useExhaustiveDependencies: 写真が替わったときだけ捨てる
  useEffect(() => {
    const history = historyRef.current;
    if (history.groupTimer) clearTimeout(history.groupTimer);
    history.groupTimer = undefined;
    history.past = [];
    history.future = [];
    history.primed = false;
  }, [loaded]);

  // 変わるたびに、変わる前を履歴に積む（元に戻す用。上の「元に戻す・やり直す」）
  useEffect(() => {
    const history = historyRef.current;
    const snapshot = { layers, background };
    // 開いたときの読み込みと、戻す・やり直すで変えたときは、積まない
    if (!ready || history.restoring || !history.primed || !history.last) {
      history.restoring = false;
      history.last = snapshot;
      history.primed = ready;
      return;
    }
    // ひとまとめの途中（手を止める前）は、最初の「変わる前」だけを積んである
    if (!history.groupTimer) {
      history.past.push(history.last);
      if (history.past.length > MAX_HISTORY) history.past.shift();
      history.future = [];
    }
    if (history.groupTimer) clearTimeout(history.groupTimer);
    history.groupTimer = setTimeout(() => {
      history.groupTimer = undefined;
    }, HISTORY_GROUP_MS);
    history.last = snapshot;
  }, [layers, background, ready]);

  // 自動で決定まで進む（exportWhenReady）。1 回だけ。待っている間に変わった中身でも作れるよう、最新の confirm を ref で持つ
  const confirmRef = useRef(confirm);
  confirmRef.current = confirm;
  const autoExported = useRef(false);
  // 自動で進めている間は、エディタを見せない（その間に触って、ずらさないように）。警告で止まったら見せる
  const [autoPending, setAutoPending] = useState(exportWhenReady);
  // 待っている間に画面を離れたら、進めない。依存（ready など）が変わっただけでは、取り消さない（1 回しか走らないため）
  // 付け直したとき（開発中の StrictMode は、確かめるために一度外して付け直す）にも戻せるよう、つないだときに true にする
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);
  useEffect(() => {
    if (!exportWhenReady || autoExported.current || !ready) return;
    autoExported.current = true;
    // 続きの写真がなければ、決められないので、ふつうに編集を見せる
    if (!loaded) {
      setAutoPending(false);
      return;
    }
    void (async () => {
      // キャンバスに描き終わってから作る：文字の書体の読み込みと、フィルターのかけ直し（FILTER_DELAY_MS 後）を待ち、
      // さらに 2 フレーム待って、描画が反映されてから
      await document.fonts.ready;
      await new Promise((resolve) => setTimeout(resolve, FILTER_DELAY_MS * 2));
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      if (!mountedRef.current) return;
      // 端に背景色が出るデザインでも止めない（注文すると決めて来ているので。警告は、編集画面で決定したときに出している）
      await confirmRef.current(true);
      if (mountedRef.current) setAutoPending(false);
    })();
  }, [exportWhenReady, ready, loaded]);

  return (
    <section
      className="cb-editor"
      aria-label="バッジのデザイン"
      // 途中保存を読み終えるまでは、まだ見せない（空の画面が一瞬出て、続きの画面に切り替わるのを見せない）
      data-ready={ready && !autoPending}
      aria-busy={!ready || autoPending}
    >
      {/* キャンバスと、それを直接動かす道具。広い画面では左に置き、操作のパネル（右）を下へ送っても見えるようにする */}
      <div className="cb-editor__stage">
        <div
          ref={frameRef}
          className="cb-editor__frame"
          // 幅の上限は CSS（画面の高さでも抑える）。高さは、決まった幅に合わせる
          style={{ height: displayPx }}
          onPointerDown={(event) => {
            setTouched(true);
            onPointerDown(event);
          }}
          onWheel={() => setTouched(true)}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerEnd}
          onPointerCancel={onPointerEnd}
          role="img"
          aria-label={
            loaded
              ? "バッジのデザイン。指でドラッグして動かし、2 本の指で拡大・回転できます"
              : "左上の「画像を選ぶ」から画像を選ぶと、ここに表示されます"
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
                {/*
                 * 印刷される範囲の端。ここまで、写真がないと、端が白く出る。
                 * すぐ内側の縁（実線）と見分けられるよう、点線にする（線の見かたの印も点線）
                 */}
                <Circle
                  radius={diameter / 2 - lineWidth * 0.6}
                  stroke={colors.safe}
                  strokeWidth={lineWidth * 1.2}
                  dash={[lineWidth * 0.6, lineWidth * 2]}
                  lineCap="round"
                  opacity={0.8}
                />
                {/* バッジの縁（内径）。薄い線にして、縁ぎりぎりの絵を隠さない */}
                <Circle
                  radius={cutRadius}
                  stroke={colors.safe}
                  strokeWidth={lineWidth * 0.6}
                  opacity={0.7}
                />
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
                    {/* つまみ：四隅で大きさ、上の丸で回転（指で押せる広さは、描く大きさより広い） */}
                    <Line
                      points={[
                        0,
                        -selectedExtent.halfHeightMm,
                        0,
                        -selectedExtent.halfHeightMm - rotateOffsetMm,
                      ]}
                      stroke={colors.cut}
                      strokeWidth={lineWidth}
                    />
                    <Circle
                      y={-selectedExtent.halfHeightMm - rotateOffsetMm}
                      radius={handleMm / 2}
                      fill={colors.handle}
                      stroke={colors.cut}
                      strokeWidth={lineWidth}
                    />
                    {[-1, 1].flatMap((sx) =>
                      [-1, 1].map((sy) => (
                        <Rect
                          key={`${sx}${sy}`}
                          x={sx * selectedExtent.halfWidthMm - handleMm / 2}
                          y={sy * selectedExtent.halfHeightMm - handleMm / 2}
                          width={handleMm}
                          height={handleMm}
                          fill={colors.handle}
                          stroke={colors.cut}
                          strokeWidth={lineWidth}
                        />
                      )),
                    )}
                  </Group>
                )}
              </Group>
            </KonvaLayer>
          </Stage>
          {/* 写真を選ぶ・替える入口。キャンバスの左上に置き、どの道具のタブを開いていても、すぐ替えられるようにする */}
          <label
            className="cb-editor__change"
            // キャンバスのドラッグとして受け取らない
            onPointerDown={(event) => event.stopPropagation()}
          >
            <svg
              viewBox="0 0 24 24"
              width="18"
              height="18"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <rect x="3" y="5" width="18" height="14" rx="2" />
              <circle cx="9" cy="10" r="1.6" />
              <path d="m21 16-5-5-8 8" />
            </svg>
            {loaded ? "画像を変える" : "画像を選ぶ"}
            <input
              type="file"
              accept="image/*"
              className="cb-editor__file"
              onChange={choosePhoto}
            />
          </label>
          {/*
           * はじめに戻す。キャンバスの右上のゴミ箱。全部消える操作なので、
           * 1 回目は「もう一度押すと全部消えます」と広げて伝え、2 回目で消す
           */}
          {(loaded || layers.length > 0) && (
            <button
              ref={resetRef}
              type="button"
              className="cb-editor__reset"
              data-confirming={confirmingReset}
              aria-label={confirmingReset ? "もう一度押すと全部消えます" : "はじめに戻す"}
              title="はじめに戻す"
              // キャンバスのドラッグとして受け取らない
              onPointerDown={(event) => event.stopPropagation()}
              onClick={resetAll}
            >
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3" />
              </svg>
              {confirmingReset && <span>もう一度押すと全部消えます</span>}
            </button>
          )}
          {/* 直接動かせることの案内。ボタンより先に、キャンバスで触ってもらう。触ったら消す */}
          {loaded && !touched && !penMode && (
            <p className="cb-editor__hint" aria-hidden="true">
              <span className="cb-editor__hint-fine">ドラッグで移動・ホイールで拡大</span>
              <span className="cb-editor__hint-coarse">指でドラッグ・2 本の指で拡大と回転</span>
            </p>
          )}
        </div>

        {/*
         * 線の見かた。折りたたまず、最初から 1 行で見せる（キャンバスの線が何かを、探さなくてよい）。
         * 詳しい説明は、マウスを乗せたときの説明と、読み上げで伝える
         */}
        <ul className="cb-editor__legend" aria-label="線の見かた">
          <li title="バッジの縁。外側は、缶の裏に折り込まれます">
            <span className="cb-editor__key" aria-hidden="true" />縁
            <span className="cb-editor__visually-hidden">（外側は、缶の裏に折り込まれます）</span>
          </li>
          <li title="文字や顔など、欠けてほしくないものは、この線の内側に置きます。外側は、縁の丸みで欠けて見えることがあります">
            <span className="cb-editor__key cb-editor__key--safe" aria-hidden="true" />
            欠けずに見える範囲
            <span className="cb-editor__visually-hidden">
              （文字や顔など、欠けてほしくないものは、この線の内側に置きます）
            </span>
          </li>
          <li title="印刷の端（印刷される範囲の端）。ここまで画像があると、端に背景色が出ません">
            <span className="cb-editor__key cb-editor__key--print" aria-hidden="true" />
            印刷の端
            <span className="cb-editor__visually-hidden">
              （ここまで画像があると、端に背景色が出ません）
            </span>
          </li>
        </ul>

        {/* 選んでいる層（写真・文字・スタンプ）を、細かく動かす道具。キャンバスの直接操作の補い */}
        <fieldset className="cb-editor__tools">
          <legend className="cb-editor__visually-hidden">選んだものを動かす</legend>
          <ToolButton label="縮小" onClick={() => zoomBy(1 / ZOOM_STEP)} disabled={disabledTools}>
            <ZoomOutIcon />
          </ToolButton>
          <ToolButton label="拡大" onClick={() => zoomBy(ZOOM_STEP)} disabled={disabledTools}>
            <ZoomInIcon />
          </ToolButton>
          <span className="cb-editor__tools-gap" aria-hidden="true" />
          <ToolButton
            label="左に回す"
            onClick={() => rotateBy(-ROTATE_STEP_DEG)}
            disabled={disabledTools}
          >
            <RotateLeftIcon />
          </ToolButton>
          <ToolButton
            label="右に回す"
            onClick={() => rotateBy(ROTATE_STEP_DEG)}
            disabled={disabledTools}
          >
            <RotateRightIcon />
          </ToolButton>
          <span className="cb-editor__tools-gap" aria-hidden="true" />
          <ToolButton label="中央に置く" onClick={centerActive} disabled={disabledTools}>
            <CenterIcon />
          </ToolButton>
          <ToolButton label="位置を戻す" onClick={resetActive} disabled={disabledTools}>
            <ResetIcon />
          </ToolButton>
          {/* 選び替える相手（文字・スタンプ）があるときだけ出す。押せないボタンを並べても、迷わせるだけ */}
          {layers.filter(isMovable).length >= 2 && (
            <ToolButton
              label="次のものを選ぶ"
              onClick={() => select(nextLayerId(layers, activeId))}
            >
              <NextIcon />
            </ToolButton>
          )}
          {selectedDecor && (
            <>
              <span className="cb-editor__tools-gap" aria-hidden="true" />
              <ToolButton
                label="手前に出す"
                onClick={() => setLayers((current) => bringToFront(current, selectedDecor.id))}
              >
                <FrontIcon />
              </ToolButton>
              <ToolButton label="消す" onClick={removeActive}>
                <TrashIcon />
              </ToolButton>
            </>
          )}
        </fieldset>

        {/* PC（マウスなど、細かく指せる端末）だけ。指の端末は、2 本の指で拡大と回転ができるので出さない（editor.css） */}
        <div className="cb-editor__sliders">
          <label className="cb-editor__slider" title="大きさ">
            <ZoomInIcon />
            <span className="cb-editor__visually-hidden">大きさ</span>
            <input
              type="range"
              className="cb-editor__range"
              min={-ZOOM_SLIDER_MAX}
              max={ZOOM_SLIDER_MAX}
              step={0.01}
              value={zoomValue}
              disabled={disabledTools}
              onChange={(event) => setZoom(Number(event.target.value))}
            />
          </label>
          <label className="cb-editor__slider" title="回転">
            <RotateRightIcon />
            <span className="cb-editor__visually-hidden">回転</span>
            <input
              type="range"
              className="cb-editor__range"
              min={-180}
              max={180}
              step={1}
              value={rotationValue}
              disabled={disabledTools}
              onChange={(event) => setRotation(Number(event.target.value))}
            />
            <output>{Math.round(rotationValue)}°</output>
          </label>
        </div>

        <div className="cb-editor__notices">
          {message && <Notice tone="error">{message}</Notice>}
          {resumed && <Notice>前回の続きから再開しました。</Notice>}
          {showCoarse && (
            <Notice>
              この画像は小さいため、印刷すると粗く見えることがあります。小さくするか、別の画像にしてください。
            </Notice>
          )}
        </div>
      </div>

      {/* 操作のパネル（道具の切り替え・道具の中身・決定）。広い画面では右に置く */}
      <div className="cb-editor__controls">
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
          {tab === "text" && (
            <TextPanel
              selected={active?.type === "text" ? active : undefined}
              draft={draft}
              onDraft={(patch) => setDraft((current) => ({ ...current, ...patch }))}
              onChangeSelected={changeText}
              onAdd={addText}
              onNew={() => setSelectedId(undefined)}
              hasText={layers.some((layer) => layer.type === "text")}
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
              onClear={() => setConfirmingClear(true)}
            />
          )}
          {tab === "background" && <BackgroundPanel color={background} onColor={setBackground} />}
          {tab === "filter" && (
            <FilterPanel
              filter={filter}
              adjust={adjust}
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
              onAdjust={changeAdjust}
            />
          )}
        </div>

        {/* 画像を選ぶまで、下のボタン（3D・決定）は押せない。黙って押せなくすると迷うので、理由を添える */}
        {!imageLayer && !busy && (
          <p className="cb-muted" role="status">
            先に画像を選んでください
          </p>
        )}

        {/* 3D の完成予想。重いので、押してから作る。開いている間は、デザインに合わせて作り直す */}
        {preview3dEnabled && (
          <div className="cb-editor__preview3d-area">
            {preview3d && <LazyBadgePreview3D src={preview3d} spec={spec} />}
            <div className="cb-editor__preview3d-actions">
              {!preview3d && (
                <Button
                  variant="line"
                  onClick={() => void showPreview3d()}
                  disabled={!canExport || preview3dBusy}
                >
                  {preview3dBusy ? "作っています…" : "3D で完成予想を見る"}
                </Button>
              )}
              {preview3d && (
                <Button variant="line" onClick={() => setPreviewUrl(undefined)}>
                  閉じる
                </Button>
              )}
            </div>
          </div>
        )}

        {/*
         * 写真が印刷範囲を覆っていない（端に背景色が出る）まま、決定を押したとき。編集の途中では出さない（動かしている最中は、出たり消えたりするため）。
         * その場で直せるよう、合わせるボタンを添える。Esc で閉じたときは、写真を動かさず、閉じるだけ
         */}
        <ConfirmDialog
          open={confirmingClear}
          title="描いたものを全部消します"
          confirmLabel="全部消す"
          onConfirm={() => {
            clearDrawing();
            setConfirmingClear(false);
          }}
          onCancel={() => setConfirmingClear(false)}
        >
          <p>ペンで描いた線が、全部消えます。画像・文字・スタンプは、そのまま残ります。</p>
        </ConfirmDialog>

        <ConfirmDialog
          open={warnUncovered && uncovered}
          title="端に背景色が含まれます"
          confirmLabel="このまま進む"
          cancelLabel="合わせる"
          onConfirm={() => void confirm(true)}
          onCancel={() => {
            coverImage();
            setWarnUncovered(false);
          }}
          onDismiss={() => setWarnUncovered(false)}
        >
          <p>画像が印刷の端まで届いていません。「合わせる」を押すと、画像を端まで広げます。</p>
        </ConfirmDialog>

        <Button
          size="large"
          block
          className="cb-editor__confirm"
          onClick={() => void confirm()}
          disabled={!canExport}
        >
          {busy ? "作っています…" : confirmLabel}
        </Button>
      </div>
    </section>
  );
}

/** 動かす道具の、アイコンだけの小さなボタン。名前は、読み上げ（aria-label）と、マウスを乗せたときの説明（title）で出す */
function ToolButton({
  label,
  onClick,
  disabled = false,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      className="cb-editor__icon"
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
    >
      {children}
    </button>
  );
}

/** 値が delayMs のあいだ変わらなかったら、その値を返す（動かしている最中の、行ったり来たりを拾わない） */
function useSettled<T>(value: T, delayMs: number): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);
  return settled;
}
