import { type BadgeSpec, printDiameterMm } from "@canbadge/badge-spec";
import {
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  CatmullRomCurve3,
  CircleGeometry,
  DataTexture,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  LatheGeometry,
  LinearFilter,
  LinearMipmapLinearFilter,
  Mesh,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  Path,
  RepeatWrapping,
  RGBAFormat,
  Shape,
  ShapeGeometry,
  SplineCurve,
  type Texture,
  TorusGeometry,
  Vector2,
  Vector3,
} from "three";
import { TessellateModifier } from "three/addons/modifiers/TessellateModifier.js";
import { type BadgeFilm, createFilmMaterial, FILM_DIM, setFilmMode } from "./kiraFilm";
import { printLook } from "./printLook";

/*
 * 缶バッジの形（寸法は mm。z が表の向き）。市販の 58mm 缶バッジの 3D モデルの断面を測り、その値をなぞる：
 * - 表のブリキに、印刷した紙と透明フィルムをかぶせ、縁で裏の内側まで巻き込む（塗り足しの 6mm が側面と裏に回る）
 * - 裏のブリキ（カラー）は、外周の平らな輪から斜めの壁を上って、深くくぼんだ裏板になる。
 *   表の巻き込みと裏の輪が合わさるところが、表と裏のつなぎ目
 * - 安全ピンは、土台の針金を爪 2 つで裏板のスリットに留める。バネはピンの面の中で平らに巻き、
 *   針の先は、板を D の字に折った留め金に収まる
 * 見た目のための値で、印刷の寸法（badgeSpec）には関係しない
 */

/** 測った断面の、もとの半径。直径が違うバッジでは、この比で全体を伸び縮みさせる */
const REFERENCE_RADIUS = 29;
/** 断面の高さの基準。表のてっぺん（3.59）と、裏のブリキの外縁のいちばん外（-0.9）の真ん中を、原点にそろえる */
const REFERENCE_MID_Z = 1.345;

/** 表（紙）の断面。中心 → ゆるいふくらみ → 縁の丸み → 底で裏へ巻き込み → 裏の内側へ折り返す */
const FACE_POINTS: readonly (readonly [number, number])[] = [
  // 表側は、巻き込みの付け根（z=0.6）から上の高さを、測った値の 72% に縮めて薄くしてある。
  // 中央のふくらみも、測った値（てっぺん 5.28）の 35% に抑えて、平らにしてある
  [0, 3.588],
  [10.8, 3.588],
  [14.8, 3.566],
  [18.9, 3.516],
  [20.8, 3.48],
  [22.6, 3.437],
  [24.2, 3.386],
  [25.7, 3.199],
  [26.9, 2.94],
  [27.8, 2.594],
  [28.5, 2.141],
  [28.9, 1.644],
  // ここから下は、表の巻き込み。半径 0.8 の小さな丸み（中心 r=28.2, z=0.6）で裏へ回り込み、
  // 裏を覆うのは縁だけにとどめる（その内側に、裏のブリキの外縁が出っ張って見える）
  [29, 1.032],
  [29, 0.6],
  [28.952, 0.326],
  [28.813, 0.086],
  [28.6, -0.093],
  [28.339, -0.188],
  [28.061, -0.188],
  [27.8, -0.093],
  [27.587, 0.086],
];

/**
 * 裏のブリキの断面（外周の部分）。裏板の縁 → 斜めの壁 → 外周の平らな輪 → 表の巻き込みの内側へ立ち上がる。
 * 表のブリキは、縁だけを小さく巻き込んで裏を覆い、その内側で、裏のブリキの外縁が丸くふくらんで
 * 表の巻き込み（底 -0.2）より外へ出っ張る（いちばん外 -0.9）。裏板は、外縁の内側にくぼみ、中央がゆるく外へふくらむ。
 * くぼみの深さは、横から見て安全ピンが外縁に隠れるように決める：ピンのいちばん外側は、裏板の中央（0.75）から
 * 針金の高さ 0.45 と、針金の中心から外側まで 0.95 を引いた -0.65 で、外縁（-0.9）の内側に収まる
 * 中の裏板（穴が開く）は、別に作る
 */
const COLLAR_POINTS: readonly (readonly [number, number])[] = [
  [21.6, 1.1],
  [22, 1.1],
  [22.5, 0.95],
  [23.2, 0.6],
  [24, 0.15],
  [24.8, -0.3],
  // 外縁。丸くふくらんで、表の巻き込み（底 -0.2）より外へ出っ張る
  [25.5, -0.65],
  [26.1, -0.84],
  [26.7, -0.9],
  [27.2, -0.8],
  [27.6, -0.55],
  // 外の端は、表の巻き込みの内側へ回り込んで隠れる
  [27.85, -0.2],
  [27.95, 0.1],
  [27.95, 0.4],
];

/** つなぎ目（表の巻き込みと、裏の外周の輪が合わさるところ） */
const SEAM: readonly [number, number] = [27.87, -0.15];
/** 裏板の半径と、縁の高さ。裏板は、中央が外（-z）へ PLATE_BULGE だけ、ゆるくふくらむ */
const PLATE_RADIUS = 21.6;
const PLATE_Z = 1.1;
const PLATE_BULGE = 0.35;
/** バッジの内側（表のブリキの裏）。穴の奥に見える。裏板の縁から、この深さにある */
const INTERIOR_DEPTH = 0.7;
/** ブリキの厚み。穴の切り口に見える */
const TIN_THICKNESS = 0.25;

/**
 * マグネット加工の裏。裏板はくぼませず、外周の縁とほぼ同じ高さの平らな面にし（ピンの穴はない）、
 * 真ん中から、ブリキで覆った円柱（中に磁石）が外へ出っ張る。寸法は mm（直径 58mm のバッジの値。ほかの大きさでは比で伸び縮み）
 */
const MAGNET_BACK_POINTS: readonly (readonly [number, number])[] = [
  [0, -0.6],
  [20, -0.6],
  [23.5, -0.62],
  // ここから外は、安全ピンの裏と同じ外縁（丸くふくらんで、表の巻き込みより外へ出る）
  [25.5, -0.7],
  [26.1, -0.84],
  [26.7, -0.9],
  [27.2, -0.8],
  [27.6, -0.55],
  [27.85, -0.2],
  [27.95, 0.1],
  [27.95, 0.4],
];
/**
 * 磁石を覆う円柱の断面。裏板からまっすぐ立ち上がる側面（付け根につばは付けない）→ 丸めた角 → てっぺん（ごくわずかにふくらむ）。
 * 直径 18mm・裏板から 0.6mm だけ、わずかに出っ張る（出っ張りが大きいと、実物より目立って見える）
 */
const MAGNET_CAP_POINTS: readonly (readonly [number, number])[] = [
  [9.0, -0.55],
  [9.0, -0.8],
  [8.85, -1.0],
  [8.4, -1.12],
  [5, -1.17],
  [0, -1.2],
];

/** 裏の作り。安全ピン（くぼんだ裏板に留める）か、マグネット（真ん中が出っ張る） */
export type BadgeBack = "pin" | "magnet";

/** 裏板の高さ（中心からの距離 r での z。測った断面の座標のまま） */
function plateZAt(r: number): number {
  return PLATE_Z - PLATE_BULGE * (1 - Math.min(1, (r / PLATE_RADIUS) ** 2));
}

/*
 * 安全ピン（寸法は mm）。形は、市販の安全ピンの 3D モデル（開いた状態）の針を、留め金に収めて閉じたもの。
 * 頂点・法線・三角形を assets/safety-pin.bin に入れてある（全長 29.5mm・幅 6.8mm・厚み 1.9mm。まっすぐな針金の区間だけを縮めて、37mm から短くしたもの）。
 * x がピンの向き、y が 2 本の針金の並び（土台が +y）、z は裏板側の面が 0 で、外へ向かって負
 */
const PIN_URL = new URL("./assets/safety-pin.bin", import.meta.url);
/** ファイルの先頭の印（"PIN1"）。違うファイルを読んだら、ピンを出さない */
const PIN_MAGIC = 0x50494e31;
/**
 * 土台の針金の中心の、裏板からの高さ。折り返した板で、裏板に強く締め付けられているので、
 * 針金はほぼ裏板に接する（針金の半径 0.34 に、わずかなすき間）。ピン全体の高さも、ここから決まる。
 * バネは針金より厚いので、中央付近では裏板側がわずかに裏板に沈む
 */
const PIN_WIRE_LIFT = 0.45;
/** ピンの中の、土台の針金の位置（y と、厚みの中心の z）と、太さ（半径） */
const PIN_BASE_Y = 3.05;
/** ピン全体の位置。バッジの中心から、少し上（+y）にずらして付ける */
const PIN_OFFSET_Y = 2.33;
const PIN_BASE_Z = -0.97;
const PIN_WIRE_RADIUS = 0.34;
/*
 * ピンの留め方。裏板に、上が広く下へ丸く細くなる、水滴のような切り込みを 2 か所入れ、切り込んだ三角の板で土台の針金をくるみ、
 * 板の先を穴からバッジの内側へ折り込む。裏から見ると、水滴の形の穴が 2 つ開いていて、
 * 上の半分を、針金をくるむ板がふさぎ、下の半分から、バッジの内側と、折り込んだ板の先が見える
 */
/** 穴の x。土台の針金は、バネ（x=-13.2）から留め金（x=7.3）まで。写真の通り、留め金側から全長の 36%・69% */
const TAB_XS = [-5.6, 4.1] as const;
/**
 * 穴（水滴のような丸みのある形。上が広く、下へ細くなる）。上の辺（板の付け根）の幅と、
 * その位置（針金より外側 +y）。形の細かいところは HOLE_KEY_POINTS
 */
const HOLE_WIDTH = 3.3;
// 付け根は、針金をくるむ半径（TAB_WRAP_RADIUS = 0.51）のすぐ外。これより上だと、板が針金より上に出て浮いて見える
const HOLE_TOP = 0.55;
/** 板の厚みと、針金のまわりに巻く半径（針金の表面から、少しだけ離れる） */
const TAB_THICKNESS = 0.22;
const TAB_WRAP_RADIUS = PIN_WIRE_RADIUS + 0.06 + 0.11;
/** 板と穴の縁のすき間（片側） */
const TAB_CLEARANCE = 0.04;

/** 円周の分割数。縁が角ばって見えない数 */
const SEGMENTS = 160;

type ProfilePoint = { r: number; z: number };

/** 測った点を、なめらかな曲線でつないで、細かい点の列にする */
function smoothProfile(
  points: readonly (readonly [number, number])[],
  scale: number,
  divisions: number,
): ProfilePoint[] {
  const curve = new SplineCurve(
    points.map(([r, z]) => new Vector2(r * scale, (z - REFERENCE_MID_Z) * scale)),
  );
  return curve.getSpacedPoints(divisions).map((p) => ({ r: Math.max(0, p.x), z: p.y }));
}

/** 紙は伸び縮みしないので、印刷円の半径（塗り足しの端）を、断面に沿った長さで使い切ったところで止める */
function clipToLength(points: ProfilePoint[], length: number): ProfilePoint[] {
  const clipped: ProfilePoint[] = [points[0] as ProfilePoint];
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1] as ProfilePoint;
    const b = points[i] as ProfilePoint;
    const step = Math.hypot(b.r - a.r, b.z - a.z);
    if (total + step >= length) {
      const t = (length - total) / step;
      clipped.push({ r: a.r + (b.r - a.r) * t, z: a.z + (b.z - a.z) * t });
      return clipped;
    }
    total += step;
    clipped.push(b);
  }
  return clipped;
}

/**
 * 断面を z 軸のまわりに回した面。UV は、断面に沿った長さを半径にした平面の座標にする。
 * こうすると、印刷した円形の画像が、紙を巻き込んだときと同じように、側面と裏まで回り込む
 */
function wrappedSurface(profile: ProfilePoint[], uvRadius: number): BufferGeometry {
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  let length = 0;
  profile.forEach((point, i) => {
    if (i > 0) {
      const prev = profile[i - 1] as ProfilePoint;
      length += Math.hypot(point.r - prev.r, point.z - prev.z);
    }
    const uvScale = length / uvRadius / 2;
    for (let j = 0; j <= SEGMENTS; j++) {
      const theta = (j / SEGMENTS) * Math.PI * 2;
      const cos = Math.cos(theta);
      const sin = Math.sin(theta);
      positions.push(point.r * cos, point.r * sin, point.z);
      uvs.push(0.5 + uvScale * cos, 0.5 + uvScale * sin);
    }
  });
  const row = SEGMENTS + 1;
  for (let i = 0; i < profile.length - 1; i++) {
    for (let j = 0; j < SEGMENTS; j++) {
      const a = i * row + j;
      const b = a + row;
      // 外側（表・側面）を向く向きに三角形を張る
      indices.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

/** 裏のブリキ。断面を回したあと、UV を平面の座標に直す（ヘアラインを、渦ではなく、まっすぐ流すため） */
function collarSurface(profile: ProfilePoint[], radius: number): BufferGeometry {
  const geometry = new LatheGeometry(
    profile.map((p) => new Vector2(p.r, p.z)),
    SEGMENTS,
  );
  // LatheGeometry は y 軸まわりに回すので、x 軸で 90° 回して、y を z に向ける
  geometry.rotateX(Math.PI / 2);
  const position = geometry.getAttribute("position");
  const uvs: number[] = [];
  for (let i = 0; i < position.count; i++) {
    uvs.push(position.getX(i) / (radius * 2) + 0.5, position.getY(i) / (radius * 2) + 0.5);
  }
  geometry.setAttribute("uv", new Float32BufferAttribute(uvs, 2));
  return geometry;
}

/**
 * ブリキのヘアライン（細かい斜めの擦り傷）の法線マップ。画像は読み込まず、乱数の筋から作る。
 * 斜めの 1 本ごとに高さを決めて、隣との差を傾きにする
 */
function brushedNormalMap(): DataTexture {
  const size = 256;
  const lines = size * 2;
  // 同じ見た目になるよう、決まった種から作る乱数
  let seed = 7;
  const random = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  const height = Array.from({ length: lines }, () => random() ** 3);
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const k = (x + y) % lines;
      const slope =
        (height[(k + 1) % lines] as number) - (height[(k + lines - 1) % lines] as number);
      const i = (y * size + x) * 4;
      // 筋に直交する向き（斜め 45°）に傾ける
      data[i] = 128 + slope * 40;
      data[i + 1] = 128 + slope * 40;
      data[i + 2] = 255;
      data[i + 3] = 255;
    }
  }
  const texture = new DataTexture(data, size, size, RGBAFormat);
  texture.wrapS = RepeatWrapping;
  texture.wrapT = RepeatWrapping;
  texture.repeat.set(3, 3);
  texture.magFilter = LinearFilter;
  texture.minFilter = LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  return texture;
}

type Disposable = { dispose(): void };

/** assets/safety-pin.bin を読む。中身は、頂点数・添字数、位置（float32）、法線（int16）、添字（uint16） */
function parsePinGeometry(buffer: ArrayBuffer): BufferGeometry | undefined {
  const [magic, vertexCount, indexCount] = new Uint32Array(buffer, 0, 3);
  if (magic !== PIN_MAGIC || !vertexCount || !indexCount) return undefined;
  let offset = 12;
  const positions = new Float32Array(buffer, offset, vertexCount * 3);
  offset += positions.byteLength;
  const normals = new Int16Array(buffer, offset, vertexCount * 3);
  offset += normals.byteLength;
  const indices = new Uint16Array(buffer, offset, indexCount);
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(positions, 3));
  geometry.setAttribute("normal", new BufferAttribute(normals, 3, true));
  geometry.setIndex(new BufferAttribute(indices, 1));
  return geometry;
}

/**
 * 折り返した板の中心線（断面 y-z。原点は針金の中心、裏板は z=plateGap）。直線と円弧だけで組む：
 * 付け根から針金の横へ真っすぐ立ち上がる → 針金の外側を半円で回る → 真っすぐ下りて穴から内側へ入る →
 * 裏板の内側で丸く折り返し、付け根のほうへ平らに伸びる。reentry は、裏板の内側へ入るまでの長さ
 */
function tabPath(plateGap: number): { points: Vector2[]; reentry: number } {
  const r = TAB_WRAP_RADIUS;
  const inside = plateGap + TIN_THICKNESS;
  const fold = 0.35;
  const points: Vector2[] = [];
  const line = (from: Vector2, to: Vector2, steps: number) => {
    for (let i = points.length === 0 ? 0 : 1; i <= steps; i++) {
      points.push(new Vector2().lerpVectors(from, to, i / steps));
    }
  };
  const arc = (cy: number, cz: number, radius: number, from: number, to: number, steps: number) => {
    for (let i = 1; i <= steps; i++) {
      const angle = from + ((to - from) * i) / steps;
      points.push(new Vector2(cy + radius * Math.cos(angle), cz + radius * Math.sin(angle)));
    }
  };
  // 付け根から、針金の横へ（ほぼ真っすぐ立ち上がる）
  line(new Vector2(HOLE_TOP, plateGap), new Vector2(r, 0), 10);
  // 針金の外側（-z）を半円で回り、針側（-y）へ
  arc(0, 0, r, 0, -Math.PI, 40);
  // 真っすぐ下りて、穴を通って裏板の内側へ
  line(new Vector2(-r, 0), new Vector2(-r, inside), 10);
  const reentry = pathLength(points);
  // 裏板の内側で丸く折り返し、付け根のほうへ平らに
  arc(-r + fold, inside, fold, Math.PI, Math.PI / 2, 12);
  line(new Vector2(-r + fold, inside + fold), new Vector2(1.1, inside + fold), 8);
  return { points, reentry };
}

function pathLength(points: Vector2[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    total += (points[i] as Vector2).distanceTo(points[i - 1] as Vector2);
  }
  return total;
}

/**
 * 穴の輪郭の要所（右半分。上の辺の真ん中が原点、下が -y。幅 3mm・高さ 6mm のときの値）。
 * 上の辺がいちばん広く、両側はゆるいふくらみで細くなり、下は円に沿った広い丸みで閉じる
 */
const HOLE_KEY_POINTS: readonly (readonly [number, number])[] = [
  [0, 0],
  [0.9, 0],
  [1.5, -0.3],
  [1.46, -1.2],
  [1.32, -2.4],
  [1.12, -3.5],
  // 下の先は、半径 0.85 ほどの円に沿わせて、広く丸める
  [0.98, -4.4],
  [0.85, -5.1],
  [0.8, -5.44],
  [0.6, -5.75],
  [0.33, -5.93],
  [0, -6],
];

/** 穴の輪郭。要所を、閉じたなめらかな曲線（Catmull-Rom）で結ぶ。上の辺の真ん中を原点に、下（-y）へ */
function holeOutline(height: number): Vector2[] {
  const sx = HOLE_WIDTH / 3;
  const sy = height / 6;
  const right = HOLE_KEY_POINTS.map(([x, y]) => new Vector3(x * sx, y * sy, 0));
  // 右半分（上の真ん中 → 下の先）と、左右反転した左半分（下の先の次 → 上の真ん中の手前）で、1 周
  const left = right
    .slice(1, -1)
    .reverse()
    .map((p) => new Vector3(-p.x, p.y, 0));
  const curve = new CatmullRomCurve3([...right, ...left], true, "centripetal");
  return curve.getSpacedPoints(200).map((p) => new Vector2(p.x, p.y));
}

/**
 * 穴の上の辺から d だけ下での、穴の幅の半分（輪郭の右側を、その高さで切ったところ）。
 * 板は、この穴を切り込んで作ったものなので、付け根から d の長さでの板の幅にもなる
 */
function holeHalfWidth(outline: Vector2[], d: number): number {
  const y = -d;
  let half = 0;
  for (let i = 0; i < outline.length; i++) {
    const a = outline[i] as Vector2;
    const b = outline[(i + 1) % outline.length] as Vector2;
    if ((a.y - y) * (b.y - y) > 0 || a.y === b.y) continue;
    const x = a.x + ((b.x - a.x) * (y - a.y)) / (b.y - a.y);
    half = Math.max(half, x);
  }
  return half;
}

/**
 * 折り返した板。tabPath の中心線に沿って、厚み TAB_THICKNESS の帯を張る。
 * 幅は、外から見える部分は一定で、裏板の内側へ入ってからは、穴の輪郭に合わせて細くなる
 */
function foldedTabGeometry(
  { points: path, reentry }: { points: Vector2[]; reentry: number },
  outline: Vector2[],
): BufferGeometry {
  // 外から見える部分（付け根から、裏板の内側へ戻るまで）は、付け根の幅のまま一定にする。
  // 途中で細くすると、巻いているところの片側だけが細く、ねじれて見える
  // 幅は、穴のいちばん広いところに合わせる（上の端は角が丸いぶん狭く、そこに合わせると穴より細く見える）
  const widestHalf = Math.max(...outline.map((p) => p.x));
  const fullWidth = 2 * (widestHalf - TAB_CLEARANCE);
  const positions: number[] = [];
  const indices: number[] = [];
  const half = TAB_THICKNESS / 2;
  let length = 0;
  path.forEach((p, i) => {
    if (i > 0) length += p.distanceTo(path[i - 1] as Vector2);
    const prev = path[Math.max(0, i - 1)] as Vector2;
    const next = path[Math.min(path.length - 1, i + 1)] as Vector2;
    const dir = new Vector2().subVectors(next, prev).normalize();
    const normal = new Vector2(-dir.y, dir.x);
    const width =
      length <= reentry
        ? fullWidth
        : Math.max(0.15, Math.min(fullWidth, 2 * (holeHalfWidth(outline, length) - TAB_CLEARANCE)));
    // 断面の 4 隅：(左・右) × (外側・内側)
    for (const [side, thick] of [
      [-1, -1],
      [1, -1],
      [1, 1],
      [-1, 1],
    ] as const) {
      positions.push(
        (side * width) / 2,
        p.x + normal.x * half * thick,
        p.y + normal.y * half * thick,
      );
    }
  });
  for (let i = 0; i < path.length - 1; i++) {
    for (let k = 0; k < 4; k++) {
      const a = i * 4 + k;
      const b = i * 4 + ((k + 1) % 4);
      indices.push(a, a + 4, b, b, a + 4, b + 4);
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

/** 穴の位置（バッジの座標。scale を掛ける前）。x、穴の上の辺の y、輪郭、穴の高さ */
type PinHole = { x: number; topY: number; outline: Vector2[]; height: number };

/** ピンを留める穴 2 つの形と位置。裏板（穴を開ける）と、折り返した板の両方が使う */
function pinHoles(): PinHole[] {
  return TAB_XS.map((x) => {
    const holeR = Math.hypot(x, PIN_OFFSET_Y + PIN_BASE_Y);
    const plateGap = plateZAt(holeR) - pinBaseWireZ();
    const height = pathLength(tabPath(plateGap).points);
    return { x, topY: PIN_OFFSET_Y + PIN_BASE_Y + HOLE_TOP, outline: holeOutline(height), height };
  });
}

/** 土台の針金の中心の高さ。ピンの中心での裏板から、PIN_WIRE_LIFT だけ外（-z） */
function pinBaseWireZ(): number {
  return plateZAt(PIN_OFFSET_Y) - PIN_WIRE_LIFT;
}

/** ピンを置く高さ（ピンの、裏板側の面）。土台の針金から逆算する */
function pinFaceZ(): number {
  return pinBaseWireZ() - PIN_BASE_Z;
}

/**
 * 安全ピン一式と、それを留める折り返した板。ピンの形はファイルから読むので、読み終わったら group に足す。
 * 座標は、測った断面のまま（REFERENCE_MID_Z を引く前）。呼ぶ側で、ずらして、伸び縮みさせる
 */
function safetyPin(
  pinMetal: MeshStandardMaterial,
  holes: PinHole[],
  add: <T extends Disposable>(r: T) => T,
  isDisposed: () => boolean,
): Group {
  const pin = new Group();

  fetch(PIN_URL)
    .then((response) => (response.ok ? response.arrayBuffer() : undefined))
    .then((buffer) => {
      const geometry = buffer && parsePinGeometry(buffer);
      if (!geometry || isDisposed()) {
        geometry?.dispose();
        return;
      }
      const mesh = new Mesh(add(geometry), pinMetal);
      mesh.position.z = pinFaceZ();
      mesh.castShadow = true;
      pin.add(mesh);
    })
    // ピンが読めなくても、バッジは見せる（穴と板だけになる）
    .catch(() => undefined);

  const wireZ = pinBaseWireZ();
  for (const hole of holes) {
    const plateGap = plateZAt(Math.hypot(hole.x, PIN_OFFSET_Y + PIN_BASE_Y)) - wireZ;
    const tab = new Mesh(add(foldedTabGeometry(tabPath(plateGap), hole.outline)), pinMetal);
    tab.position.set(hole.x, PIN_BASE_Y, wireZ);
    tab.castShadow = true;
    pin.add(tab);
  }
  return pin;
}

/** 裏板の平らな形（円に、ピンを留める穴を開けたもの）。y 軸まわりに 180° 回して外（-z）へ向ける前の向き */
function plateShape(holes: PinHole[], scale: number): Shape {
  const shape = new Shape();
  shape.absarc(0, 0, PLATE_RADIUS * scale, 0, Math.PI * 2, false);
  for (const hole of holes) {
    // あとで y 軸まわりに 180° 回して外（-z）へ向けるので、x を左右反転して置く
    shape.holes.push(
      new Path(
        hole.outline.map((p) => new Vector2(-(hole.x + p.x) * scale, (hole.topY + p.y) * scale)),
      ),
    );
  }
  return shape;
}

/**
 * 裏板。中央がゆるくふくらんだ円板に、ピンを留める水滴の形の穴を開ける。
 * 平らな形（穴あき）を細かい三角形に分けてから、ふくらみに合わせて曲げる。座標はバッジの座標（scale 済み）
 */
function plateSurface(holes: PinHole[], scale: number, radius: number): BufferGeometry {
  const plateRadius = PLATE_RADIUS * scale;
  const shape = plateShape(holes, scale);
  const flat = new ShapeGeometry(shape, 96);
  flat.rotateY(Math.PI);
  // 曲げるために、細かい三角形に分ける。分けた三角形の継ぎ目には、曲げるとごく細い割れ目ができるが、
  // すぐ奥に重ねた平らな裏打ち（plateBacking）が同じ金属なので、割れ目から奥の暗い面は見えない
  const geometry = new TessellateModifier(1.2 * scale, 8).modify(flat);
  flat.dispose();

  const position = geometry.getAttribute("position");
  const normals: number[] = [];
  const uvs: number[] = [];
  const bulge = PLATE_BULGE * scale;
  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i);
    const y = position.getY(i);
    const r = Math.hypot(x, y) / scale;
    position.setZ(i, (plateZAt(r) - REFERENCE_MID_Z) * scale);
    // ふくらみ z = 縁 - bulge × (1 - r²/R²) の、外向き（-z 側）の法線
    const slope = (2 * bulge) / plateRadius ** 2;
    const n = new Vector3(slope * x, slope * y, -1).normalize();
    normals.push(n.x, n.y, n.z);
    uvs.push(x / (radius * 2) + 0.5, y / (radius * 2) + 0.5);
  }
  geometry.setAttribute("normal", new Float32BufferAttribute(normals, 3));
  geometry.setAttribute("uv", new Float32BufferAttribute(uvs, 2));
  return geometry;
}

/**
 * 裏板の裏打ち。穴だけ開いた平らな円板を、裏板のいちばん奥（縁の高さ）より少し奥に置く。
 * 曲げた裏板の三角形の継ぎ目にできる細い割れ目から、奥の暗い面が点々と見えるのを隠す
 */
function plateBacking(holes: PinHole[], scale: number): BufferGeometry {
  const geometry = new ShapeGeometry(plateShape(holes, scale), 96);
  geometry.rotateY(Math.PI);
  geometry.translate(0, 0, (PLATE_Z + 0.05 - REFERENCE_MID_Z) * scale);
  return geometry;
}

/** 穴の切り口。裏板の面から、ブリキの厚みだけ内側（+z）へ下りる壁 */
function holeWalls(holes: PinHole[], scale: number): BufferGeometry {
  const positions: number[] = [];
  const indices: number[] = [];
  for (const hole of holes) {
    const start = positions.length / 3;
    for (const p of hole.outline) {
      const x = (hole.x + p.x) * scale;
      const y = (hole.topY + p.y) * scale;
      const z = (plateZAt(Math.hypot(hole.x + p.x, hole.topY + p.y)) - REFERENCE_MID_Z) * scale;
      positions.push(x, y, z, x, y, z + TIN_THICKNESS * scale);
    }
    const count = hole.outline.length;
    for (let i = 0; i < count; i++) {
      const a = start + i * 2;
      const b = start + ((i + 1) % count) * 2;
      indices.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

export type BadgeModel = {
  group: Group;
  /** 表の紙に、印刷する画像（塗り足しまで含む全体）を貼る */
  setArtwork(texture: Texture): void;
  /** キラフィルム（なし・割れガラス・オーロラ）を付け替える。3D を作り直さずに、見た目だけ替える */
  setFilm(film: BadgeFilm): void;
  dispose(): void;
};

/** 缶バッジの 3D モデル（表の紙・裏のブリキ・つなぎ目・安全ピンかマグネット）を作る */
export function createBadgeModel(spec: BadgeSpec, back: BadgeBack = "pin"): BadgeModel {
  const radius = spec.diameterMm / 2;
  const scale = radius / REFERENCE_RADIUS;
  const paperRadius = printDiameterMm(spec) / 2;
  const disposables: Disposable[] = [];
  let disposed = false;
  const add = <T extends Disposable>(resource: T): T => {
    disposables.push(resource);
    return resource;
  };

  // ブリキ（すずめっき鋼板）。明るい銀色で、細かいヘアラインが入る。
  // 金属の度合いを少し下げて、光をそのまま返す分を残す（下げないと、映り込む景色しだいで暗く沈む）
  const metal = add(
    new MeshStandardMaterial({
      // 全体の露出を上げた（BadgePreview3D）ので、裏が光りすぎないよう、色を一段落とす
      color: 0xc4c7cb,
      metalness: 0.7,
      roughness: 0.34,
      normalMap: add(brushedNormalMap()),
      side: DoubleSide,
    }),
  );
  metal.normalScale.set(0.22, 0.22);
  // 安全ピンは、ニッケルめっきの針金。ブリキより白く光る。
  // つるつるにしすぎると、留め金の平らな面が暗い景色を映して、黒く見える
  const pinMetal = add(
    new MeshStandardMaterial({ color: 0xd2d4d7, metalness: 0.9, roughness: 0.24 }),
  );
  // 紙の上の透明フィルム。画像が届くまでは、白い紙のまま。
  // つやや照り返しが強いと、部屋の映り込みと光が絵の上に乗って白く飛ぶ（斜めから見ると、特に）。
  // 絵の色がそのまま見えるよう、照り返しは弱く、フィルムのつやは、ごく薄く曇らせる
  const paper = add(
    new MeshPhysicalMaterial({
      // 絵の色に掛け合わさるので、真っ白にする（灰色がかると、絵が全体にくすむ）
      color: 0xffffff,
      roughness: 0.8,
      metalness: 0,
      specularIntensity: 0.3,
      clearcoat: 0.12,
      clearcoatRoughness: 0.45,
      envMapIntensity: 0.3,
      side: DoubleSide,
    }),
  );

  const group = new Group();
  const faceProfile = clipToLength(smoothProfile(FACE_POINTS, scale, 240), paperRadius);
  const faceGeometry = add(wrappedSurface(faceProfile, paperRadius));
  const face = new Mesh(faceGeometry, paper);
  face.castShadow = true;
  // キラフィルム。紙と同じ形の面を、紙の手前に重ねる（最初は付けない）
  const filmMaterial = add(createFilmMaterial());
  const film = new Mesh(faceGeometry, filmMaterial);
  film.visible = false;
  // 紙の色（フィルムで少し暗くなる分）。絵を貼り替えても、フィルムの暗さは残す
  let paperTone = 1;

  // つなぎ目。表の巻き込みと、裏のブリキの外縁が合わさる、ごく細い溝。
  // 濃い色や太い線にすると、横から見たとき黒い輪郭が浮いて見えるので、ブリキより少し暗い程度の淡い影にとどめる
  const [seamR, seamZ] = SEAM;
  const seam = new Mesh(
    add(new TorusGeometry(seamR * scale, 0.05 * scale, 8, SEGMENTS)),
    add(new MeshStandardMaterial({ color: 0x9a9da2, metalness: 0.5, roughness: 0.6 })),
  );
  seam.position.z = (seamZ - REFERENCE_MID_Z) * scale;

  if (back === "magnet") {
    // 裏は、平らな裏板と外縁をひと続きの面にする（穴がないので、裏板を別に作らない）
    const backSurface = new Mesh(
      add(collarSurface(smoothProfile(MAGNET_BACK_POINTS, scale, 200), radius)),
      metal,
    );
    backSurface.receiveShadow = true;
    // 真ん中の出っ張り（磁石を覆うブリキの円柱）。光の向きで、裏板に影を落とす
    const cap = new Mesh(
      add(collarSurface(smoothProfile(MAGNET_CAP_POINTS, scale, 120), radius)),
      metal,
    );
    cap.castShadow = true;
    cap.receiveShadow = true;
    group.add(face, film, backSurface, cap, seam);
    return finish();
  }

  const collar = new Mesh(
    add(collarSurface(smoothProfile(COLLAR_POINTS, scale, 160), radius)),
    metal,
  );
  collar.receiveShadow = true;

  // 裏板（ピンを留める穴あき）。安全ピンの影を落とす
  const holes = pinHoles();
  const plate = new Mesh(add(plateSurface(holes, scale, radius)), metal);
  plate.receiveShadow = true;
  const backing = new Mesh(add(plateBacking(holes, scale)), metal);
  const walls = new Mesh(add(holeWalls(holes, scale)), metal);
  // 穴の奥に見える、バッジの内側（表のブリキの裏）。暗い金属
  const interiorGeometry = add(new CircleGeometry(PLATE_RADIUS * scale, 96));
  interiorGeometry.rotateY(Math.PI);
  const interior = new Mesh(
    interiorGeometry,
    add(new MeshStandardMaterial({ color: 0x45484d, metalness: 0.4, roughness: 0.7 })),
  );
  interior.position.z = (PLATE_Z + INTERIOR_DEPTH - REFERENCE_MID_Z) * scale;

  // ピンは測った寸法のまま作り、バッジの大きさに合わせて全体を伸び縮みさせる
  const pin = safetyPin(pinMetal, holes, add, () => disposed);
  pin.position.set(0, PIN_OFFSET_Y * scale, -REFERENCE_MID_Z * scale);
  pin.scale.setScalar(scale);

  group.add(face, film, collar, plate, backing, walls, interior, seam, pin);
  return finish();

  function finish(): BadgeModel {
    return {
      group,
      setArtwork(texture) {
        // 編集中は何度も貼り替えるので、前の絵を手放す（残すと、閉じるまで GPU のメモリがふくらむ）
        const previous = paper.map;
        if (previous) {
          previous.dispose();
          const index = disposables.indexOf(previous);
          if (index >= 0) disposables.splice(index, 1);
        }
        // 実物（紙にインクジェットで印刷し、フィルムをかぶせたもの）に近い、暗めの色と細かい粒にして貼る
        const source = texture.image as
          | (CanvasImageSource & { width: number; height: number })
          | null;
        const printed = source ? printLook(source) : undefined;
        if (printed) {
          const look = new CanvasTexture(printed);
          look.colorSpace = texture.colorSpace;
          look.anisotropy = texture.anisotropy;
          texture.dispose();
          paper.map = add(look);
        } else {
          paper.map = add(texture);
        }
        paper.color.setScalar(paperTone);
        paper.needsUpdate = true;
      },
      setFilm(next) {
        film.visible = next !== "none";
        setFilmMode(filmMaterial, next);
        paperTone = next === "none" ? 1 : FILM_DIM;
        paper.color.setScalar(paperTone);
      },
      dispose() {
        disposed = true;
        for (const resource of disposables) resource.dispose();
      },
    };
  }
}
