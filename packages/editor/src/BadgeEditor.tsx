import { type BadgeSpec, mmToPx, printDiameterMm, safeDiameterMm } from "@canbadge/badge-spec";
import { Button, Notice } from "@canbadge/ui";
import type Konva from "konva";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Circle, Group, Image as KonvaImage, Layer, Rect, Shape, Stage } from "react-konva";
import { resolveColor } from "./css-color";
import {
  applyDrag,
  applyPinch,
  applyRotation,
  applyZoom,
  clampCenter,
  clampWidth,
  coversCircle,
  type Placement,
  type Point,
} from "./gesture";
import { coverWidthMm, effectiveDpi } from "./image-size";
import { type LoadedImage, loadImage } from "./load-image";
import { createEmptyState, DEFAULT_BACKGROUND, type EditorState, parseEditorState } from "./model";

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
  confirmLabel?: string;
  onExport: (result: BadgeEditorExport) => void;
};

/** 写真の大きさの範囲（印刷する円の直径に対する倍率）。小さすぎると見失い、大きすぎると描画が重くなる */
const MIN_WIDTH_RATIO = 0.2;
const MAX_WIDTH_RATIO = 8;
const ZOOM_STEP = 1.15;
const ROTATE_STEP_DEG = 15;
/** これより粗い写真は、印刷でぼやける。警告を出す目安（dpi） */
const MIN_RECOMMENDED_DPI = 150;
/** 編集画面の一辺の上限（CSS px）。大きな画面でも、スマホの操作と同じ大きさで確かめられる */
const MAX_DISPLAY_PX = 480;

type Loaded = { image: LoadedImage; aspect: number };

export function BadgeEditor({
  spec,
  initialData,
  initialImage,
  confirmLabel = "これで決定",
  onExport,
}: BadgeEditorProps) {
  const diameter = printDiameterMm(spec);
  const cutRadius = spec.diameterMm / 2;
  const safeRadius = safeDiameterMm(spec) / 2;

  const restored = useMemo(() => parseEditorState(initialData), [initialData]);
  const [loaded, setLoaded] = useState<Loaded | undefined>(undefined);
  const [placement, setPlacement] = useState<Placement | undefined>(undefined);
  const [background] = useState(restored?.background.color ?? DEFAULT_BACKGROUND);
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

  const limits = useMemo(
    () => ({
      min: diameter * MIN_WIDTH_RATIO,
      max: diameter * MAX_WIDTH_RATIO,
      center: diameter / 2,
    }),
    [diameter],
  );
  const constrain = useCallback(
    (next: Placement): Placement =>
      clampCenter(clampWidth(next, limits.min, limits.max), limits.center),
    [limits],
  );

  /** 写真を、キャンバスをすき間なく覆う大きさで、中央に置く */
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
    async (source: Blob | string, keep?: Placement) => {
      setMessage(undefined);
      try {
        const image = await loadImage(source);
        const aspect = image.width / image.height;
        setLoaded({ image, aspect });
        setPlacement(keep ?? fit(aspect));
      } catch (error) {
        setMessage(error instanceof Error ? error.message : "画像を読み込めませんでした");
      }
    },
    [fit],
  );

  // 最初の写真。保存してあった位置があれば、それを使う
  useEffect(() => {
    if (!initialImage) return;
    const saved = restored?.layers.find((layer) => layer.type === "image");
    void accept(
      initialImage,
      saved && {
        x: saved.xMm,
        y: saved.yMm,
        widthMm: saved.widthMm,
        rotationDeg: saved.rotationDeg,
      },
    );
  }, [initialImage, restored, accept]);

  // ---- 指・マウスの操作（ポインターイベント）----

  const pointers = useRef(new Map<number, Point>());

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

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!placement) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    pointers.current.set(event.pointerId, toMm(event));
  };

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const before = pointers.current.get(event.pointerId);
    if (!before || !placement) return;
    const after = toMm(event);
    const others = [...pointers.current.entries()].filter(([id]) => id !== event.pointerId);
    pointers.current.set(event.pointerId, after);
    const other = others[0]?.[1];
    setPlacement((current) => {
      if (!current) return current;
      return constrain(
        other
          ? applyPinch(current, [before, other], [after, other])
          : applyDrag(current, before, after),
      );
    });
  };

  const onPointerEnd = (event: React.PointerEvent<HTMLDivElement>) => {
    pointers.current.delete(event.pointerId);
  };

  // マウスのホイールで、ポインターの位置を中心に拡大・縮小する。ページのスクロールは止める
  // （React の onWheel は、ページのスクロールを止められないため、直接登録する）
  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const about = toMm(event);
      const factor = Math.exp(-event.deltaY * 0.0015);
      setPlacement((current) => current && constrain(applyZoom(current, about, factor)));
    };
    frame.addEventListener("wheel", onWheel, { passive: false });
    return () => frame.removeEventListener("wheel", onWheel);
  }, [toMm, constrain]);

  // ---- ボタン ----

  const center: Point = { x: 0, y: 0 };
  const zoomBy = (factor: number) =>
    setPlacement((current) => current && constrain(applyZoom(current, center, factor)));
  const rotateBy = (degrees: number) =>
    setPlacement((current) => current && applyRotation(current, center, degrees));

  const choose = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    // 同じファイルをもう一度選んでも反応するよう、選んだあとに空にする
    event.target.value = "";
    if (file) void accept(file);
  };

  const confirm = async () => {
    const stage = stageRef.current;
    if (!stage || !loaded || !placement) return;
    setBusy(true);
    setMessage(undefined);
    // ガイド線は印刷に入れない。出力の間だけ隠す
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
          layers: [
            {
              type: "image",
              xMm: placement.x,
              yMm: placement.y,
              widthMm: placement.widthMm,
              aspect: loaded.aspect,
              rotationDeg: placement.rotationDeg,
            },
          ],
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
  const height = placement && loaded ? placement.widthMm / loaded.aspect : 0;
  // 写真が、印刷される範囲（塗り足しを含む円）を覆っていないと、その部分は、背景の色のまま印刷される
  const uncovered =
    placement && loaded ? !coversCircle(placement, loaded.aspect, diameter / 2) : false;
  const coarse =
    placement && loaded
      ? effectiveDpi(loaded.image.width, placement.widthMm) < MIN_RECOMMENDED_DPI
      : false;

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
          <Layer listening={false}>
            <Rect x={0} y={0} width={diameter} height={diameter} fill={background} />
            <Group x={diameter / 2} y={diameter / 2}>
              {loaded && placement && (
                <KonvaImage
                  image={loaded.image.canvas}
                  x={placement.x}
                  y={placement.y}
                  width={placement.widthMm}
                  height={height}
                  offsetX={placement.widthMm / 2}
                  offsetY={height / 2}
                  rotation={placement.rotationDeg}
                />
              )}
            </Group>
          </Layer>
          <Layer ref={guidesRef} listening={false}>
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
            </Group>
          </Layer>
        </Stage>
      </div>

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

      {message && <Notice tone="error">{message}</Notice>}
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

      <div className="cb-editor__tools">
        <label className="cb-button cb-button--line">
          {loaded ? "写真を選びなおす" : "写真を選ぶ"}
          <input type="file" accept="image/*" className="cb-editor__file" onChange={choose} />
        </label>
        <Button variant="line" onClick={() => zoomBy(ZOOM_STEP)} disabled={!placement}>
          拡大
        </Button>
        <Button variant="line" onClick={() => zoomBy(1 / ZOOM_STEP)} disabled={!placement}>
          縮小
        </Button>
        <Button variant="line" onClick={() => rotateBy(-ROTATE_STEP_DEG)} disabled={!placement}>
          左に回す
        </Button>
        <Button variant="line" onClick={() => rotateBy(ROTATE_STEP_DEG)} disabled={!placement}>
          右に回す
        </Button>
        <Button
          variant="line"
          onClick={() => loaded && setPlacement(fit(loaded.aspect))}
          disabled={!placement}
        >
          位置を戻す
        </Button>
      </div>

      <Button size="large" block onClick={() => void confirm()} disabled={!placement || busy}>
        {busy ? "作っています…" : confirmLabel}
      </Button>
    </section>
  );
}
