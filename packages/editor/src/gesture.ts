// 写真の移動・拡大・回転の計算。画面の入力（ポインター）から切り離し、数値だけで確かめられるようにする。
// 点はすべて、キャンバスの中心を原点にした mm の座標（右・下が正）。

export type Point = { x: number; y: number };

/** 写真の位置と大きさ。x・y は写真の中心、widthMm は表示する幅、rotationDeg は時計回りの角度 */
export type Placement = {
  x: number;
  y: number;
  widthMm: number;
  rotationDeg: number;
};

const toRadians = (degrees: number): number => (degrees * Math.PI) / 180;
const toDegrees = (radians: number): number => (radians * 180) / Math.PI;

const midpoint = (a: Point, b: Point): Point => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
const distance = (a: Point, b: Point): number => Math.hypot(b.x - a.x, b.y - a.y);
const angleOf = (a: Point, b: Point): number => Math.atan2(b.y - a.y, b.x - a.x);

/**
 * 角度の差を、-180 度（含まない）から 180 度（含む）の間にする。2 本の指の線の角度は、
 * ちょうど 180 度の付近で、+180 と -180 を行き来する。そのまま引くと、小さな回転が 360 度の回転になる
 */
const normalizeAngle = (radians: number): number =>
  Math.atan2(Math.sin(radians), Math.cos(radians));

/** 1 本の指（またはマウス）でのドラッグ。動いた分だけ、写真が動く */
export function applyDrag(placement: Placement, from: Point, to: Point): Placement {
  return { ...placement, x: placement.x + (to.x - from.x), y: placement.y + (to.y - from.y) };
}

/**
 * 2 本の指でのピンチ。指の間隔の比で拡大し、指の線の角度の変化で回転し、中点の移動で動かす。
 * 動かす前に 2 本の指の間にあった写真の点が、動かしたあとも、2 本の指の間に残る
 * （指を置いた場所の写真が、指についてくる）
 */
export function applyPinch(
  placement: Placement,
  before: readonly [Point, Point],
  after: readonly [Point, Point],
): Placement {
  const distanceBefore = distance(before[0], before[1]);
  // 2 本の指が重なっていると、比も角度も決まらない。何もしない
  if (distanceBefore === 0) return placement;
  const scale = distance(after[0], after[1]) / distanceBefore;
  const turn = normalizeAngle(angleOf(after[0], after[1]) - angleOf(before[0], before[1]));

  const centerBefore = midpoint(before[0], before[1]);
  const centerAfter = midpoint(after[0], after[1]);
  // 写真の中心が、指の中点からどれだけ離れているかを、拡大・回転してから、新しい中点に足す
  const dx = placement.x - centerBefore.x;
  const dy = placement.y - centerBefore.y;
  const cos = Math.cos(turn);
  const sin = Math.sin(turn);
  return {
    x: centerAfter.x + scale * (dx * cos - dy * sin),
    y: centerAfter.y + scale * (dx * sin + dy * cos),
    widthMm: placement.widthMm * scale,
    rotationDeg: placement.rotationDeg + toDegrees(turn),
  };
}

/** 点 about を中心に、倍率 factor で拡大・縮小する（マウスのホイール、ボタン用）。about に重なる写真の点は動かない */
export function applyZoom(placement: Placement, about: Point, factor: number): Placement {
  return {
    ...placement,
    x: about.x + (placement.x - about.x) * factor,
    y: about.y + (placement.y - about.y) * factor,
    widthMm: placement.widthMm * factor,
  };
}

/** 点 about を中心に、角度 degrees だけ回転する（ボタン用）。about に重なる写真の点は動かない */
export function applyRotation(placement: Placement, about: Point, degrees: number): Placement {
  const radians = toRadians(degrees);
  const dx = placement.x - about.x;
  const dy = placement.y - about.y;
  return {
    ...placement,
    x: about.x + dx * Math.cos(radians) - dy * Math.sin(radians),
    y: about.y + dx * Math.sin(radians) + dy * Math.cos(radians),
    rotationDeg: placement.rotationDeg + degrees,
  };
}

/** 幅を範囲に収める。小さくしすぎて写真を見失ったり、大きくしすぎて端末の描画が重くなるのを防ぐ（位置は変えない） */
export function clampWidth(
  placement: Placement,
  minWidthMm: number,
  maxWidthMm: number,
): Placement {
  const widthMm = Math.min(maxWidthMm, Math.max(minWidthMm, placement.widthMm));
  return widthMm === placement.widthMm ? placement : { ...placement, widthMm };
}

/**
 * 写真（回転した長方形）が、キャンバスの中心にある、半径 radiusMm の円を、すき間なく覆っているか。
 * 円は回転しても同じなので、円の中心を写真の座標（写真の中心が原点、向きを揃えたもの）に移して、
 * 円が長方形に収まるかを見る
 */
export function coversCircle(placement: Placement, aspect: number, radiusMm: number): boolean {
  const theta = toRadians(placement.rotationDeg);
  const dx = -placement.x;
  const dy = -placement.y;
  const localX = dx * Math.cos(theta) + dy * Math.sin(theta);
  const localY = -dx * Math.sin(theta) + dy * Math.cos(theta);
  const epsilon = 1e-6;
  return (
    Math.abs(localX) + radiusMm <= placement.widthMm / 2 + epsilon &&
    Math.abs(localY) + radiusMm <= placement.widthMm / aspect / 2 + epsilon
  );
}

/**
 * 写真の中心を、キャンバスの外に出しすぎない範囲に収める。中心が印刷する円から、円の半径ぶん以上
 * 離れると、写真を見失う（画面から消える）ので、そこで止める
 */
export function clampCenter(placement: Placement, limitMm: number): Placement {
  const length = Math.hypot(placement.x, placement.y);
  if (length <= limitMm) return placement;
  const ratio = limitMm / length;
  return { ...placement, x: placement.x * ratio, y: placement.y * ratio };
}

/** 選んだ文字・スタンプの枠につく、つまみ。四隅で大きさ、枠の上の丸で回転 */
export type Handle = "scale" | "rotate";

/**
 * 点が、どのつまみに触れているか。枠は、中心 center・回転 rotationDeg・半分の幅と高さ half（回す前の向き）。
 * 回転のつまみは、枠の上辺から rotateOffsetMm 上。hitMm は、指で押しやすいよう、描く大きさより広めにとる
 */
export function handleAt(
  point: Point,
  center: Point,
  rotationDeg: number,
  half: { width: number; height: number },
  rotateOffsetMm: number,
  hitMm: number,
): Handle | undefined {
  // 枠の向き（回す前）にそろえて比べる
  const radians = -toRadians(rotationDeg);
  const dx = point.x - center.x;
  const dy = point.y - center.y;
  const local = {
    x: dx * Math.cos(radians) - dy * Math.sin(radians),
    y: dx * Math.sin(radians) + dy * Math.cos(radians),
  };
  if (distance(local, { x: 0, y: -half.height - rotateOffsetMm }) <= hitMm) return "rotate";
  for (const sx of [-1, 1]) {
    for (const sy of [-1, 1]) {
      if (distance(local, { x: sx * half.width, y: sy * half.height }) <= hitMm) return "scale";
    }
  }
  return undefined;
}

/** 大きさのつまみを、from から to へ動かした。中心 about からの距離の比で拡大・縮小する */
export function applyHandleScale(
  placement: Placement,
  about: Point,
  from: Point,
  to: Point,
): Placement {
  const before = distance(about, from);
  if (before < 1e-6) return placement;
  return applyZoom(placement, about, distance(about, to) / before);
}

/** 回転のつまみを、from から to へ動かした。中心 about から見た角度の差だけ回す */
export function applyHandleRotation(
  placement: Placement,
  about: Point,
  from: Point,
  to: Point,
): Placement {
  const turn = normalizeAngle(angleOf(about, to) - angleOf(about, from));
  return applyRotation(placement, about, toDegrees(turn));
}
