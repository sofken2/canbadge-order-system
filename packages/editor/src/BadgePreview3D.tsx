import { type BadgeSpec, printDiameterMm } from "@canbadge/badge-spec";
import { useEffect, useRef, useState } from "react";
import {
  AmbientLight,
  CircleGeometry,
  CylinderGeometry,
  DirectionalLight,
  Group,
  Mesh,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  PerspectiveCamera,
  PMREMGenerator,
  Scene,
  SRGBColorSpace,
  TextureLoader,
  TorusGeometry,
  WebGLRenderer,
} from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { OutputPreview } from "./OutputPreview";

/** 缶バッジの厚み（mm）。見た目のための値で、印刷の寸法には関係しない */
const THICKNESS_MM = 3;
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
export function BadgePreview3D({ src, spec }: { src: string; spec: BadgeSpec }) {
  const hostRef = useRef<HTMLDivElement>(null);
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
    scene.add(new AmbientLight(0xffffff, 0.35));
    const key = new DirectionalLight(0xffffff, 1.2);
    key.position.set(-40, 60, 80);
    scene.add(key);

    const metal = new MeshStandardMaterial({ color: 0xc8ccd2, metalness: 1, roughness: 0.32 });
    const badge = new Group();
    const disposables: { dispose(): void }[] = [pmrem, environment, metal];

    const add = <T extends { dispose(): void }>(resource: T): T => {
      disposables.push(resource);
      return resource;
    };
    const rim = new Mesh(
      add(new CylinderGeometry(radius, radius, THICKNESS_MM, 96, 1, true)),
      metal,
    );
    rim.rotation.x = Math.PI / 2;
    const back = new Mesh(add(new CircleGeometry(radius, 96)), metal);
    back.position.z = -THICKNESS_MM / 2;
    back.rotation.y = Math.PI;
    badge.add(rim, back);
    // 縁の丸み。表の絵の端を 0.3mm だけ覆うくらいの太さ
    for (const side of [1, -1]) {
      const ring = new Mesh(add(new TorusGeometry(radius + 0.3, 0.6, 12, 96)), metal);
      ring.position.z = (side * THICKNESS_MM) / 2;
      badge.add(ring);
    }
    badge.rotation.x = TILT_RAD;
    scene.add(badge);

    let yaw = -0.5;
    let dragging = false;
    let lastX = 0;
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
      }
      badge.rotation.y = yaw;
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
      downX = event.clientX;
      dragDistance = 0;
      host.setPointerCapture(event.pointerId);
      request();
    };
    const onPointerMove = (event: PointerEvent) => {
      if (!dragging) return;
      yaw += (event.clientX - lastX) * DRAG_RAD_PER_PX;
      lastX = event.clientX;
      dragDistance = Math.max(dragDistance, Math.abs(event.clientX - downX));
      resumeAt = performance.now() + IDLE_MS;
      request();
    };
    const onPointerEnd = (event: PointerEvent) => {
      if (!dragging) return;
      dragging = false;
      if (event.type === "pointerup" && dragDistance < TAP_MAX_PX) {
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

    new TextureLoader()
      .loadAsync(src)
      .then((texture) => {
        if (disposed) {
          texture.dispose();
          return;
        }
        texture.colorSpace = SRGBColorSpace;
        texture.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy());
        // 画像は塗り足しまで含む全体なので、表に見える内径の円の部分だけを貼る
        const visibleRatio = spec.diameterMm / printDiameterMm(spec);
        texture.repeat.set(visibleRatio, visibleRatio);
        texture.offset.set((1 - visibleRatio) / 2, (1 - visibleRatio) / 2);
        const face = new Mesh(
          add(new CircleGeometry(radius, 96)),
          add(
            new MeshPhysicalMaterial({
              map: add(texture),
              roughness: 0.4,
              metalness: 0,
              clearcoat: 1,
              clearcoatRoughness: 0.06,
            }),
          ),
        );
        face.position.z = THICKNESS_MM / 2;
        badge.add(face);
        resume();
      })
      .catch(() => {
        if (!disposed) setFailed(true);
      });

    resize();

    return () => {
      disposed = true;
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
  }, [src, spec]);

  if (failed) return <OutputPreview src={src} spec={spec} />;
  return (
    <div
      ref={hostRef}
      className="cb-editor__preview3d"
      role="img"
      aria-label="缶バッジの完成予想（3D）。ドラッグで回せます"
    />
  );
}
