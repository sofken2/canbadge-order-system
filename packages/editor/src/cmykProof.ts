/**
 * 画面の色（RGB）を、CMYK のインクで刷ったらどう見えるか、ざっくり再現する（ソフトプルーフ風）。
 * 画面の鮮やかな青・緑・蛍光色は、インクでは出せずにくすむ。それを 3D の完成予想で先に見せるため。
 * 正確な色合わせ（ICC プロファイル）ではなく、見た目の目安。印刷に使う PNG には手を入れない
 */

type Rgb = readonly [number, number, number];

/**
 * インクを刷った紙の色（0〜1）。一般的なコート紙の印刷（FOGRA39 相当）を sRGB で見たときの値。
 * 紙・C・M・Y と、その重ね刷り（M+Y=赤、C+Y=緑、C+M=青、C+M+Y）の 8 色の間を混ぜて、刷った色を作る
 */
const PAPER: Rgb = [1, 1, 1];
const CYAN: Rgb = [0 / 255, 159 / 255, 227 / 255];
const MAGENTA: Rgb = [230 / 255, 0 / 255, 126 / 255];
const YELLOW: Rgb = [255 / 255, 237 / 255, 0 / 255];
const RED: Rgb = [229 / 255, 36 / 255, 32 / 255];
const GREEN: Rgb = [0 / 255, 151 / 255, 61 / 255];
const BLUE: Rgb = [46 / 255, 49 / 255, 146 / 255];
const CMY: Rgb = [60 / 255, 55 / 255, 52 / 255];
/** 墨（K）100% の色。真っ黒にはならない */
const BLACK: Rgb = [35 / 255, 31 / 255, 32 / 255];
/** インクのにじみ（網点の太り）。中間の濃さで、どれだけ濃く出るか */
const DOT_GAIN = 0.32;
/** どれだけインクの色に寄せるか（1 で刷った色そのもの、0 で画面の色のまま）。寄せきると、くすみすぎて見えるため */
const STRENGTH = 0.6;

/** RGB（0〜1）を CMYK に分けてから刷った色に戻し、刷ったときの RGB（0〜1）へ寄せて返す */
export function cmykProof(r: number, g: number, b: number): Rgb {
  // 灰色の成分は、すべて墨で刷る（CMY を重ねて灰色を作らない）。灰色が転ばず、インクも少ない
  const k = 1 - Math.max(r, g, b);
  const rest = 1 - k;
  const c = rest > 0 ? (1 - r - k) / rest : 0;
  const m = rest > 0 ? (1 - g - k) / rest : 0;
  const y = rest > 0 ? (1 - b - k) / rest : 0;

  const cc = gain(c);
  const mm = gain(m);
  const yy = gain(y);
  const kk = gain(k);
  const out: [number, number, number] = [0, 0, 0];
  for (let i = 0; i < 3; i++) {
    const color =
      (1 - cc) * (1 - mm) * (1 - yy) * (PAPER[i] as number) +
      cc * (1 - mm) * (1 - yy) * (CYAN[i] as number) +
      (1 - cc) * mm * (1 - yy) * (MAGENTA[i] as number) +
      (1 - cc) * (1 - mm) * yy * (YELLOW[i] as number) +
      (1 - cc) * mm * yy * (RED[i] as number) +
      cc * (1 - mm) * yy * (GREEN[i] as number) +
      cc * mm * (1 - yy) * (BLUE[i] as number) +
      cc * mm * yy * (CMY[i] as number);
    // 墨は、その上から重ねる
    const printed = color * (1 - kk + kk * (BLACK[i] as number));
    const screen = [r, g, b][i] as number;
    out[i] = screen + (printed - screen) * STRENGTH;
  }
  return out;
}

function gain(value: number): number {
  const v = Math.min(1, Math.max(0, value));
  return v + DOT_GAIN * v * (1 - v);
}
