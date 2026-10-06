import { describe, expect, test } from "bun:test";
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

const base: Placement = { x: 0, y: 0, widthMm: 40, rotationDeg: 0 };

const close = (actual: number, expected: number) => expect(actual).toBeCloseTo(expected, 6);

/** ピンチの前に指の下にあった写真の点が、ピンチのあとも、同じ指の下にあることを確かめるための変換 */
function followFinger(
  before: Placement,
  after: Placement,
  finger: Point,
  turnDeg: number,
  scale: number,
): Point {
  const turn = (turnDeg * Math.PI) / 180;
  const dx = finger.x - before.x;
  const dy = finger.y - before.y;
  return {
    x: after.x + scale * (dx * Math.cos(turn) - dy * Math.sin(turn)),
    y: after.y + scale * (dx * Math.sin(turn) + dy * Math.cos(turn)),
  };
}

describe("ドラッグ", () => {
  test("動いた分だけ、写真が動く", () => {
    const moved = applyDrag(base, { x: 3, y: 4 }, { x: 13, y: -6 });
    expect(moved).toEqual({ ...base, x: 10, y: -10 });
  });
});

describe("ピンチ", () => {
  test("2 本の指が同じだけ動くと、拡大も回転もせずに、同じだけ動く", () => {
    const moved = applyPinch(
      base,
      [
        { x: -10, y: 0 },
        { x: 10, y: 0 },
      ],
      [
        { x: -5, y: 5 },
        { x: 15, y: 5 },
      ],
    );
    close(moved.x, 5);
    close(moved.y, 5);
    close(moved.widthMm, 40);
    close(moved.rotationDeg, 0);
  });

  test("指の間隔が 2 倍になると、幅が 2 倍になる。中点が写真の中心なら、中心は動かない", () => {
    const zoomed = applyPinch(
      base,
      [
        { x: -10, y: 0 },
        { x: 10, y: 0 },
      ],
      [
        { x: -20, y: 0 },
        { x: 20, y: 0 },
      ],
    );
    close(zoomed.widthMm, 80);
    close(zoomed.x, 0);
    close(zoomed.y, 0);
  });

  test("中点から離れた写真は、拡大すると、中点から離れる方向に動く", () => {
    const zoomed = applyPinch(
      { ...base, x: 10 },
      [
        { x: -10, y: 0 },
        { x: 10, y: 0 },
      ],
      [
        { x: -20, y: 0 },
        { x: 20, y: 0 },
      ],
    );
    close(zoomed.x, 20);
  });

  test("指の線が 90 度回ると、写真も 90 度回り、中点まわりに位置も回る", () => {
    const turned = applyPinch(
      { ...base, x: 10 },
      [
        { x: -10, y: 0 },
        { x: 10, y: 0 },
      ],
      [
        { x: 0, y: -10 },
        { x: 0, y: 10 },
      ],
    );
    close(turned.rotationDeg, 90);
    close(turned.x, 0);
    close(turned.y, 10);
    close(turned.widthMm, 40);
  });

  test("拡大・回転・移動を同時にしても、ピンチの前に指の下にあった写真の点が、指についてくる", () => {
    const before: [Point, Point] = [
      { x: -12, y: 7 },
      { x: 9, y: -4 },
    ];
    const after: [Point, Point] = [
      { x: -20, y: 15 },
      { x: 14, y: 6 },
    ];
    const start: Placement = { x: 3, y: -2, widthMm: 40, rotationDeg: 20 };
    const next = applyPinch(start, before, after);

    const scale =
      Math.hypot(after[1].x - after[0].x, after[1].y - after[0].y) /
      Math.hypot(before[1].x - before[0].x, before[1].y - before[0].y);
    const turnDeg =
      ((Math.atan2(after[1].y - after[0].y, after[1].x - after[0].x) -
        Math.atan2(before[1].y - before[0].y, before[1].x - before[0].x)) *
        180) /
      Math.PI;

    // 中点については、厳密に保たれる。2 本の指それぞれの下の点は、中点を基準に保たれる
    const centerAfter = { x: (after[0].x + after[1].x) / 2, y: (after[0].y + after[1].y) / 2 };
    const centerBefore = { x: (before[0].x + before[1].x) / 2, y: (before[0].y + before[1].y) / 2 };
    const followed = followFinger(start, next, centerBefore, turnDeg, scale);
    close(followed.x, centerAfter.x);
    close(followed.y, centerAfter.y);
    close(next.widthMm, 40 * scale);
    close(next.rotationDeg, 20 + turnDeg);
  });

  test("指の線の角度が ±180 度をまたいでも、小さな回転は小さな回転のまま（360 度の回転にならない）", () => {
    // 左の指から右の指へ向かう線は 180 度。ほんの少し傾くと、-180 度側に移る
    const turned = applyPinch(
      base,
      [
        { x: 10, y: 0 },
        { x: -10, y: 0 },
      ],
      [
        { x: 10, y: 0.2 },
        { x: -10, y: -0.2 },
      ],
    );
    expect(turned.rotationDeg).toBeCloseTo(1.15, 1);

    // 逆向きにまたぐ場合も同じ
    const back = applyPinch(
      base,
      [
        { x: 10, y: 0.2 },
        { x: -10, y: -0.2 },
      ],
      [
        { x: 10, y: 0 },
        { x: -10, y: 0 },
      ],
    );
    expect(back.rotationDeg).toBeCloseTo(-1.15, 1);
  });

  test("2 本の指が重なっているとき（間隔 0）は、何もしない", () => {
    const same = applyPinch(
      base,
      [
        { x: 1, y: 1 },
        { x: 1, y: 1 },
      ],
      [
        { x: 5, y: 5 },
        { x: 9, y: 9 },
      ],
    );
    expect(same).toEqual(base);
  });
});

describe("ボタンとホイール", () => {
  test("拡大の中心に重なる写真の点は、動かない", () => {
    const zoomed = applyZoom(base, { x: 5, y: 5 }, 2);
    expect(zoomed).toEqual({ x: -5, y: -5, widthMm: 80, rotationDeg: 0 });
  });

  test("回転の中心まわりに、位置と角度が回る", () => {
    const rotated = applyRotation({ ...base, x: 10 }, { x: 0, y: 0 }, 90);
    close(rotated.x, 0);
    close(rotated.y, 10);
    close(rotated.rotationDeg, 90);
  });

  test("写真の中心を中心に回転すると、位置は変わらず、角度だけが変わる", () => {
    const rotated = applyRotation({ ...base, x: 7, y: 3 }, { x: 7, y: 3 }, 15);
    close(rotated.x, 7);
    close(rotated.y, 3);
    close(rotated.rotationDeg, 15);
  });
});

describe("円を覆っているか", () => {
  const radius = 35;

  test("ちょうど覆う大きさで、中央にあれば、覆っている。少しでも動かすと、覆わない", () => {
    expect(coversCircle({ x: 0, y: 0, widthMm: 70, rotationDeg: 0 }, 1, radius)).toBe(true);
    expect(coversCircle({ x: 0, y: 2, widthMm: 70, rotationDeg: 0 }, 1, radius)).toBe(false);
    expect(coversCircle({ x: 0, y: 0, widthMm: 68, rotationDeg: 0 }, 1, radius)).toBe(false);
  });

  test("大きければ、その分だけ動かしても覆っている", () => {
    expect(coversCircle({ x: 30, y: 0, widthMm: 140, rotationDeg: 0 }, 1, radius)).toBe(true);
    expect(coversCircle({ x: 40, y: 0, widthMm: 140, rotationDeg: 0 }, 1, radius)).toBe(false);
  });

  test("上だけが足りない場合（スマホの画面で見た、上に帯が出た状態）は、覆っていない", () => {
    // 幅 70 の正方形を、約 5mm 下にずらすと、上の端に、写真のない部分ができる
    expect(coversCircle({ x: 0, y: 5, widthMm: 70, rotationDeg: 0 }, 1, radius)).toBe(false);
  });

  test("中心を軸に回しても、円を覆うかどうかは変わらない。縦横比は、短い辺で決まる", () => {
    expect(coversCircle({ x: 0, y: 0, widthMm: 70, rotationDeg: 45 }, 1, radius)).toBe(true);
    // 幅 140・縦横比 2 は、高さ 70。ちょうど覆う
    expect(coversCircle({ x: 0, y: 0, widthMm: 140, rotationDeg: 0 }, 2, radius)).toBe(true);
    // 縦長（縦横比 0.5）で幅 70 は、高さ 140。覆う。幅 60 は、横が足りない
    expect(coversCircle({ x: 0, y: 0, widthMm: 70, rotationDeg: 0 }, 0.5, radius)).toBe(true);
    expect(coversCircle({ x: 0, y: 0, widthMm: 60, rotationDeg: 0 }, 0.5, radius)).toBe(false);
  });

  test("回した写真は、位置をずらすと、回した向きで覆いが外れる", () => {
    // 90 度回すと、写真の「横」が画面の「縦」になる。縦長の写真（aspect 0.5, 幅 70, 高さ 140）を
    // 90 度回して、画面の横方向に 30 ずらしても、高さ 140 の方向が横になるので、覆っている
    expect(coversCircle({ x: 30, y: 0, widthMm: 70, rotationDeg: 90 }, 0.5, radius)).toBe(true);
    // 画面の縦方向に 30 ずらすと、幅 70 の方向が縦になるので、覆わない
    expect(coversCircle({ x: 0, y: 30, widthMm: 70, rotationDeg: 90 }, 0.5, radius)).toBe(false);
  });
});

describe("範囲に収める", () => {
  test("幅は、最小と最大の間に収まる。範囲内なら、同じ値のまま", () => {
    expect(clampWidth({ ...base, widthMm: 2 }, 10, 300).widthMm).toBe(10);
    expect(clampWidth({ ...base, widthMm: 999 }, 10, 300).widthMm).toBe(300);
    expect(clampWidth(base, 10, 300)).toBe(base);
  });

  test("中心は、上限の距離までに収まる。向きは変わらない", () => {
    const clamped = clampCenter({ ...base, x: 60, y: 80 }, 50);
    close(Math.hypot(clamped.x, clamped.y), 50);
    close(clamped.x / clamped.y, 60 / 80);
    expect(clampCenter(base, 50)).toBe(base);
  });
});
