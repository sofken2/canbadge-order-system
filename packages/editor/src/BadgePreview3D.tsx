import type { BadgeSpec } from "@canbadge/badge-spec";
import { useEffect, useRef, useState } from "react";
import {
  AmbientLight,
  DirectionalLight,
  NeutralToneMapping,
  PCFShadowMap,
  PerspectiveCamera,
  PMREMGenerator,
  Scene,
  SRGBColorSpace,
  TextureLoader,
  WebGLRenderer,
} from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { type BadgeBack, type BadgeModel, createBadgeModel } from "./badgeModel";
import type { BadgeFilm } from "./kiraFilm";
import { OutputPreview } from "./OutputPreview";

/** 自動で回る速さ（rad/秒） */
const SPIN_SPEED = 0.7;
/** 触ってから、自動で回り始めるまでの間（ms） */
const IDLE_MS = 1500;
/** タップで回る長さ（ms）と、回る周の数。勢いよく回って、だんだん遅くなって止まる */
const FLIP_MS = 1500;
const FLIP_TURNS = 3;
/** 正面で止まってから、自動回転に戻るまでの間（ms） */
const FRONT_HOLD_MS = 2500;
/** これより動かさずに離したら、ドラッグではなくタップ（px） */
const TAP_MAX_PX = 6;
/** ドラッグ 1px あたりに回る角度（rad） */
const DRAG_RAD_PER_PX = 0.012;
/** 正面から少し傾けておく（真横から見ると、板に見えるため） */
const TILT_RAD = 0.18;
/** 縦のドラッグで、前後に傾けられる範囲（ラジアン。±60°）。真横（90°）を越えて裏返るほどには回さない */
const MAX_PITCH_RAD = Math.PI / 3;
/** 縦のドラッグの効き方。横と同じ */
const PITCH_PER_PX = DRAG_RAD_PER_PX;
/** 自動回転に戻ったあと、傾きが元に戻る速さ（1 秒あたりの減り方） */
const PITCH_RETURN_PER_S = 2.5;
/** 描画の解像度の上限。スマホで重くならないよう、画素密度を 2 倍までに抑える */
const MAX_PIXEL_RATIO = 2;

/** 最初は速く、終わりに向かってゆっくりになる */
const easeOutCubic = (t: number) => 1 - (1 - t) ** 3;

/**
 * 缶バッジの完成予想を、3D でくるくる回して見せる（three.js）。
 * 出力の PNG（塗り足しまで含む全体）を、バッジの表（内径の円）に貼る。
 *
 * 軽くするために：画面に見えている間と、動いている間しか描かない／自動で回らない設定の端末では、
 * 触ったときだけ描く／WebGL が使えない端末と、画像を読めなかったときは、平面の `OutputPreview` に切り替える。
 * three.js が大きいので、呼ぶ側は `LazyBadgePreview3D` 経由で読み込む（使うときまで読み込まない）
 */
export function BadgePreview3D({
  src,
  spec,
  label = "缶バッジの完成予想（3D）。ドラッグで回せます",
  onTap,
  back = "pin",
  film = "none",
}: {
  src: string;
  spec: BadgeSpec;
  /** 裏の作り。安全ピンか、マグネット（真ん中が出っ張る） */
  back?: BadgeBack;
  /** キラフィルム（なし・割れガラス・オーロラ）。替えても 3D は作り直さず、見た目だけ替える */
  film?: BadgeFilm;
  /** 読み上げの説明。完成予想ではなく見本として置くときに変える */
  label?: string;
  /** 渡すと、ドラッグせずに押したとき、表裏を返す代わりにこれを呼ぶ（はじめの画面で、写真をはめる画面を開く） */
  onTap?: () => void;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  // 押したときの処理は、描画の作り直し（effect の依存）に含めない。毎回の描画で関数が変わっても、3D を作り直さない
  const onTapRef = useRef(onTap);
  onTapRef.current = onTap;
  // フィルムは、作ったモデルに付け替えて描き直す（作り直すと、回転の位置が戻り、ちらつく）
  const filmRef = useRef(film);
  filmRef.current = film;
  const modelRef = useRef<BadgeModel | undefined>(undefined);
  const redrawRef = useRef<(() => void) | undefined>(undefined);
  const rendererRef = useRef<WebGLRenderer | undefined>(undefined);
  const resumeRef = useRef<(() => void) | undefined>(undefined);
  useEffect(() => {
    modelRef.current?.setFilm(film);
    redrawRef.current?.();
  }, [film]);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    setFailed(false);

    let renderer: WebGLRenderer;
    try {
      renderer = new WebGLRenderer({ antialias: true, alpha: true, powerPreference: "low-power" });
    } catch {
      setFailed(true);
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO));
    // 金属の明るいところが白く飛ばないように、色を崩さない方式で明るさを丸める
    renderer.toneMapping = NeutralToneMapping;
    // 全体を明るめに。暗いと、来場者の写真がくすんで見える（この方式なら、明るくしても白く飛びにくい）
    renderer.toneMappingExposure = 1.3;
    // 安全ピンが裏板に落とす影。実物らしさは、この影でいちばん変わる
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = PCFShadowMap;
    const canvas = renderer.domElement;
    canvas.style.width = "100%";
    canvas.style.height = "100%";
    canvas.style.display = "block";
    host.appendChild(canvas);

    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const radius = spec.diameterMm / 2;

    const scene = new Scene();
    const camera = new PerspectiveCamera(28, 1, 1, 1000);
    // 回しても、円がはみ出さない距離（直径に少し余白を足して、画角に収める）
    camera.position.z = (radius * 1.3) / Math.tan((camera.fov * Math.PI) / 360);

    // 金属とクリア面の反射に、環境が要る。画像は読み込まず、three.js が持つ部屋の形から作る
    const pmrem = new PMREMGenerator(renderer);
    const environment = pmrem.fromScene(new RoomEnvironment(), 0.04);
    scene.environment = environment.texture;
    // 光の当たらない側（裏や縁）も、黒くつぶれないよう、全体に明るさを足す
    scene.add(new AmbientLight(0xffffff, 0.6));
    // 主な光は、見ている側の左上から。バッジが回ると、表にも裏にも当たり、ピンの影が裏板に落ちる
    const key = new DirectionalLight(0xffffff, 1.6);
    key.position.set(-40, 60, 80);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    key.shadow.camera.left = -radius * 1.2;
    key.shadow.camera.right = radius * 1.2;
    key.shadow.camera.top = radius * 1.2;
    key.shadow.camera.bottom = -radius * 1.2;
    key.shadow.camera.near = 40;
    key.shadow.camera.far = 220;
    key.shadow.bias = -0.0005;
    key.shadow.radius = 3;
    scene.add(key);
    // 右下からの弱い光。縁の丸みに、細い光の筋を入れる
    const rim = new DirectionalLight(0xffffff, 0.6);
    rim.position.set(60, -30, 40);
    scene.add(rim);

    const model = createBadgeModel(spec, back);
    model.setFilm(filmRef.current);
    modelRef.current = model;
    const badge = model.group;
    const disposables: { dispose(): void }[] = [pmrem, environment, model];
    badge.rotation.x = TILT_RAD;
    scene.add(badge);

    let yaw = -0.5;
    let dragging = false;
    let lastX = 0;
    let lastY = 0;
    /** 縦のドラッグで傾けた分（TILT_RAD に足す） */
    let pitch = 0;
    let downY = 0;
    /** この時刻（performance.now）を過ぎたら、ゆっくりした自動回転に戻る */
    let resumeAt = -Infinity;
    /** タップで勢いよく回って、正面で止まる動き。動いていないときは undefined */
    let flip: { from: number; to: number; start: number } | undefined;
    let downX = 0;
    let dragDistance = 0;
    let visible = true;
    let frameId = 0;
    let lastTime = 0;
    let disposed = false;

    const spinning = () =>
      !reducedMotion && !dragging && flip === undefined && performance.now() > resumeAt;

    const frame = (now: number) => {
      frameId = 0;
      const dt = lastTime === 0 ? 0 : Math.min((now - lastTime) / 1000, 0.1);
      lastTime = now;
      if (flip) {
        const progress = Math.min((now - flip.start) / FLIP_MS, 1);
        yaw = flip.from + (flip.to - flip.from) * easeOutCubic(progress);
        if (progress >= 1) {
          flip = undefined;
          // 正面で止まったまま、少しのあいだ見せてから、また回り始める
          resumeAt = performance.now() + FRONT_HOLD_MS;
          window.setTimeout(resume, FRONT_HOLD_MS);
        }
      } else if (spinning()) {
        yaw += SPIN_SPEED * dt;
        // 傾けた分は、自動回転に戻ったら、ゆっくり元の角度へ戻す
        pitch *= Math.exp(-PITCH_RETURN_PER_S * dt);
      }
      badge.rotation.y = yaw;
      badge.rotation.x = TILT_RAD + pitch;
      renderer.render(scene, camera);
      // 見えている間だけ、次の描画を予約する。自動で回らない設定のときは、触ったときだけ描く
      if (visible && !document.hidden && (spinning() || dragging || flip)) request();
    };
    const request = () => {
      if (disposed || frameId !== 0) return;
      frameId = requestAnimationFrame(frame);
    };
    const resume = () => {
      lastTime = 0;
      request();
    };
    redrawRef.current = request;

    const resize = () => {
      const width = host.clientWidth;
      const height = host.clientHeight;
      if (width === 0 || height === 0) return;
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      request();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(host);

    // 画面の外に出たら止める（スクロールで見えなくなっても、描き続けない）
    const visibility = new IntersectionObserver(([entry]) => {
      visible = entry?.isIntersecting ?? true;
      if (visible) resume();
    });
    visibility.observe(host);
    const onVisibilityChange = () => {
      if (!document.hidden) resume();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);

    // タップ（ほとんど動かさずに離す）で、勢いよく回って正面を向く。ドラッグは、その場で回す
    const startFlip = () => {
      const turn = Math.PI * 2;
      // 正面は、一周ごとにある。今の向きから進む向きに数えて、次の正面の、さらに数周先で止める
      const to = Math.ceil(yaw / turn) * turn + turn * (FLIP_TURNS - 1);
      if (reducedMotion) {
        yaw = Math.round(yaw / turn) * turn;
        resumeAt = Infinity;
        request();
        return;
      }
      flip = { from: yaw, to, start: performance.now() };
      lastTime = 0;
      request();
    };

    const onPointerDown = (event: PointerEvent) => {
      dragging = true;
      flip = undefined;
      lastX = event.clientX;
      lastY = event.clientY;
      downX = event.clientX;
      downY = event.clientY;
      dragDistance = 0;
      host.setPointerCapture(event.pointerId);
      request();
    };
    const onPointerMove = (event: PointerEvent) => {
      if (!dragging) return;
      yaw += (event.clientX - lastX) * DRAG_RAD_PER_PX;
      pitch = Math.max(
        -MAX_PITCH_RAD,
        Math.min(MAX_PITCH_RAD, pitch + (event.clientY - lastY) * PITCH_PER_PX),
      );
      lastX = event.clientX;
      lastY = event.clientY;
      // 縦に動かしたときも、ドラッグ（タップではない）とみなす
      dragDistance = Math.max(
        dragDistance,
        Math.hypot(event.clientX - downX, event.clientY - downY),
      );
      resumeAt = performance.now() + IDLE_MS;
      request();
    };
    const onPointerEnd = (event: PointerEvent) => {
      if (!dragging) return;
      dragging = false;
      if (event.type === "pointerup" && dragDistance < TAP_MAX_PX) {
        if (onTapRef.current) {
          onTapRef.current();
          resumeAt = performance.now() + IDLE_MS;
          window.setTimeout(resume, IDLE_MS);
          return;
        }
        startFlip();
        return;
      }
      resumeAt = performance.now() + IDLE_MS;
      // 離した少しあとから、また回り始める
      window.setTimeout(resume, IDLE_MS);
    };
    host.addEventListener("pointerdown", onPointerDown);
    host.addEventListener("pointermove", onPointerMove);
    host.addEventListener("pointerup", onPointerEnd);
    host.addEventListener("pointercancel", onPointerEnd);

    rendererRef.current = renderer;
    resumeRef.current = resume;

    resize();

    return () => {
      disposed = true;
      modelRef.current = undefined;
      redrawRef.current = undefined;
      rendererRef.current = undefined;
      resumeRef.current = undefined;
      cancelAnimationFrame(frameId);
      observer.disconnect();
      visibility.disconnect();
      document.removeEventListener("visibilitychange", onVisibilityChange);
      host.removeEventListener("pointerdown", onPointerDown);
      host.removeEventListener("pointermove", onPointerMove);
      host.removeEventListener("pointerup", onPointerEnd);
      host.removeEventListener("pointercancel", onPointerEnd);
      for (const resource of disposables) resource.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      canvas.remove();
    };
  }, [spec, back]);

  // 絵は、作った 3D に貼り替える（作り直すと、回転の位置が戻り、ちらつく）。編集中のデザインが変わるたびに呼ばれる。
  // 3D を作り直したとき（spec・back が変わったとき）も、新しいモデルに貼り直す
  // biome-ignore lint/correctness/useExhaustiveDependencies: spec・back は、3D を作り直した合図として使う
  useEffect(() => {
    const model = modelRef.current;
    const renderer = rendererRef.current;
    if (!model || !renderer) return;
    let cancelled = false;
    new TextureLoader()
      .loadAsync(src)
      .then((texture) => {
        // 読み込む間に、次の絵に替わったか、3D を閉じたときは、貼らない
        if (cancelled || modelRef.current !== model) {
          texture.dispose();
          return;
        }
        texture.colorSpace = SRGBColorSpace;
        texture.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy());
        // 画像は塗り足しまで含む全体。表に見える円の外は、紙と同じように側面と裏へ回り込む
        model.setArtwork(texture);
        resumeRef.current?.();
      })
      // 絵が読めなくても、平面には切り替えない（切り替えると、次の絵が来ても 3D に戻れず、3D の描画も残ったままになる）。
      // 前の絵のまま見せ、次の src で貼り直す。平面に切り替えるのは、WebGL が使えないときだけ
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [src, spec, back]);

  if (failed) return <OutputPreview src={src} spec={spec} />;
  return <div ref={hostRef} className="cb-editor__preview3d" role="img" aria-label={label} />;
}
