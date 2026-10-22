import { DoubleSide, NormalBlending, ShaderMaterial } from "three";

/**
 * キラフィルム（表の紙の上に重ねる、虹色に光る透明フィルム）の見た目。
 * - shards：割れたガラスのような、尖った不ぞろいな破片（三角形と四角形）が、一部重なりながら散らばる。破片ごとに傾きが違い、
 *   回すと破片ごとに違う色でキラッと光る
 * - aurora：破片のない、なめらかな虹色の帯。角度に合わせて、色がゆっくり流れる
 * 実物のフィルムは色が淡いので、色の鮮やかさも、かぶせる濃さも控えめにする。
 * 色は、絵の上に半透明でかぶせる（足すと、白い紙の上では白より明るくできず、色が見えない）。
 * フィルムで下の絵が少し暗くなるのは、紙の色のほうで表す（FILM_DIM）
 */
export type BadgeFilm = "none" | "shards" | "aurora";

/** フィルムを付けたときの、下の絵の明るさ（1 が付けないとき）。フィルムを 1 枚通すと、少し暗くなる（暗くしすぎると、キラが映えない） */
export const FILM_DIM = 0.82;

const vertexShader = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vNormal;
  varying vec3 vViewPosition;
  void main() {
    vUv = uv;
    // 見る向きで色が変わるよう、法線と位置を、カメラから見た座標で渡す
    vNormal = normalize(normalMatrix * normal);
    vec4 viewPosition = modelViewMatrix * vec4(position, 1.0);
    vViewPosition = viewPosition.xyz;
    gl_Position = projectionMatrix * viewPosition;
  }
`;

const fragmentShader = /* glsl */ `
  uniform int uMode;
  varying vec2 vUv;
  varying vec3 vNormal;
  varying vec3 vViewPosition;

  vec3 hsv2rgb(vec3 c) {
    vec3 p = abs(fract(c.xxx + vec3(0.0, 2.0 / 3.0, 1.0 / 3.0)) * 6.0 - 3.0);
    return c.z * mix(vec3(1.0), clamp(p - 1.0, 0.0, 1.0), c.y);
  }

  vec2 hash2(vec2 p) {
    p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)));
    return fract(sin(p) * 43758.5453);
  }

  // 点 p から三角形 abc までの、符号つきの距離（内側が負）。Inigo Quilez の式
  float sdTriangle(vec2 p, vec2 a, vec2 b, vec2 c) {
    vec2 e0 = b - a, e1 = c - b, e2 = a - c;
    vec2 v0 = p - a, v1 = p - b, v2 = p - c;
    vec2 pq0 = v0 - e0 * clamp(dot(v0, e0) / dot(e0, e0), 0.0, 1.0);
    vec2 pq1 = v1 - e1 * clamp(dot(v1, e1) / dot(e1, e1), 0.0, 1.0);
    vec2 pq2 = v2 - e2 * clamp(dot(v2, e2) / dot(e2, e2), 0.0, 1.0);
    float s = sign(e0.x * e2.y - e0.y * e2.x);
    vec2 d = min(min(vec2(dot(pq0, pq0), s * (v0.x * e0.y - v0.y * e0.x)),
                     vec2(dot(pq1, pq1), s * (v1.x * e1.y - v1.y * e1.x))),
                     vec2(dot(pq2, pq2), s * (v2.x * e2.y - v2.y * e2.x)));
    return -sqrt(d.x) * sign(d.y);
  }

  // 点 p から四角形 abcd（凸でなくてよい）までの、符号つきの距離（内側が負）。Inigo Quilez の多角形の式を 4 点で
  float sdQuad(vec2 p, vec2 a, vec2 b, vec2 c, vec2 d) {
    vec2 v[4];
    v[0] = a; v[1] = b; v[2] = c; v[3] = d;
    float dist = dot(p - a, p - a);
    float s = 1.0;
    for (int i = 0; i < 4; i++) {
      int j = i == 0 ? 3 : i - 1;
      vec2 e = v[j] - v[i];
      vec2 w = p - v[i];
      vec2 q = w - e * clamp(dot(w, e) / dot(e, e), 0.0, 1.0);
      dist = min(dist, dot(q, q));
      bvec3 cond = bvec3(p.y >= v[i].y, p.y < v[j].y, e.x * w.y > e.y * w.x);
      if (all(cond) || all(not(cond))) s *= -1.0;
    }
    return s * sqrt(dist);
  }

  void main() {
    vec3 normal = normalize(vNormal);
    vec3 viewDir = normalize(-vViewPosition);
    // 斜めから見るほど強く光る（正面からは控えめ）
    float facing = clamp(dot(normal, viewDir), 0.0, 1.0);
    float glancing = 1.0 - facing;

    vec3 color;
    float alpha;
    if (uMode == 1) {
      // 割れガラス：大きさも形もばらばらの、尖った三角形と四角形の破片を散らす。区画ごとに 2 つずつ置き、
      // 隣の区画の破片とも重なる（重なったところは、手前の破片を見せる）。破片のないところは、すき間として透明に残す
      vec2 p = vUv * 12.0;
      vec2 cell = floor(p);
      float bestDepth = -1.0;
      float bestDistance = 0.0;
      vec2 bestSeed = vec2(0.0);
      for (int y = -1; y <= 1; y++) {
        for (int x = -1; x <= 1; x++) {
          for (int k = 0; k < 2; k++) {
            vec2 id = cell + vec2(float(x), float(y));
            vec2 seed = id * 2.0 + float(k) * 7.13;
            vec2 h1 = hash2(seed);
            vec2 h2 = hash2(seed + 3.1);
            vec2 h3 = hash2(seed + 5.7);
            // 一部は置かない（すき間を作る）
            if (h3.x < 0.2) continue;
            vec2 center = id + h1;
            float size = 0.35 + 0.8 * h2.x;
            float turn = h2.y * 6.2831;
            // 3 つの頂点の向きと距離を、それぞれずらして、尖った不ぞろいな三角形にする
            vec2 a = center + size * (0.6 + 0.4 * h3.y) * vec2(cos(turn), sin(turn));
            float tb = turn + 1.6 + 1.4 * h3.x;
            vec2 b = center + size * (0.4 + 0.6 * h1.y) * vec2(cos(tb), sin(tb));
            // 4 割くらいは、角を 4 つにした、不ぞろいな四角形にする（三角形だけだと、柄が単調になる）
            bool quad = hash2(seed + 11.3).x < 0.4;
            float tc = tb + (quad ? 0.9 + 0.8 * h1.x : 1.2 + 1.6 * h1.x);
            vec2 c = center + size * (0.3 + 0.7 * h2.x) * vec2(cos(tc), sin(tc));
            float td = tc + 0.9 + 0.8 * h2.y;
            vec2 e = center + size * (0.4 + 0.6 * h3.y) * vec2(cos(td), sin(td));
            float d = quad ? sdQuad(p, a, b, c, e) : sdTriangle(p, a, b, c);
            float depth = hash2(seed + 9.4).x;
            if (d < 0.0 && depth > bestDepth) {
              bestDepth = depth;
              bestDistance = d;
              bestSeed = seed;
            }
          }
        }
      }
      if (bestDepth < 0.0) {
        // すき間：ほとんど透明。斜めからだけ、ほんのり白く
        color = vec3(1.0);
        alpha = 0.03 * glancing;
      } else {
        vec2 r = hash2(bestSeed + 17.0);
        // 破片ごとの傾き。見る向きとの関係で、色と明るさが破片ごとに変わる
        vec2 tilt = normalize(r - 0.5);
        float angle = dot(normal.xy, tilt) * 3.5 + dot(viewDir.xy, tilt) * 2.0;
        float hue = fract(r.x * 1.7 + angle * 0.35);
        // 角度が合った破片ほど、強く光る
        float sparkle = pow(smoothstep(0.35, 1.0, fract(r.y * 5.3 + angle * 0.6)), 1.3);
        // 破片のふち（内側の、ごく細い帯）
        float edge = 1.0 - smoothstep(0.0, 0.035, -bestDistance);
        color = mix(hsv2rgb(vec3(hue, 0.4, 0.95)), vec3(1.0), edge * 0.5);
        alpha = 0.06 + 0.32 * sparkle + 0.05 * glancing + 0.12 * edge;
      }
    } else {
      // オーロラ：なめらかな虹色の帯。紙の上の位置と、見る向きで、色が流れる
      float band = vUv.x * 0.9 + vUv.y * 0.55 + normal.x * 1.2 + normal.y * 0.6 + viewDir.x * 0.4;
      vec3 rainbow = hsv2rgb(vec3(fract(band), 0.28, 1.0));
      // 帯の明るいところと暗いところを、ゆるやかに作る（全面が同じ明るさだと、ただの色かぶりに見える）
      float wave = 0.5 + 0.5 * sin(band * 6.2831 * 0.8);
      color = rainbow * 0.95;
      alpha = 0.1 + 0.1 * wave + 0.07 * glancing;
    }
    // 下の絵に、半透明の色をかぶせる（足すのではない。白い紙の上でも、虹色に色づいて見える）
    gl_FragColor = vec4(color, alpha);
  }
`;

/** フィルムの面の材質。紙の面と同じ形に重ねて、紙より手前に描く（同じ位置で奥行きが争わないよう、少しずらす） */
export function createFilmMaterial(): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: { uMode: { value: 0 } },
    vertexShader,
    fragmentShader,
    transparent: true,
    blending: NormalBlending,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
    side: DoubleSide,
  });
}

/** 材質を、フィルムの種類に合わせる。none のときは、面ごと隠す（呼ぶ側） */
export function setFilmMode(material: ShaderMaterial, film: BadgeFilm) {
  const mode = material.uniforms.uMode;
  if (mode) mode.value = film === "shards" ? 1 : 0;
}
