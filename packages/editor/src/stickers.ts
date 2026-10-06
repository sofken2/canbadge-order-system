// スタンプの形。すべて、このプロジェクトで作った簡単な図形（著作権の問題がない）。
// 100 × 100 の正方形の中に、パス（SVG の d）で描く。同じ向きで描いた図形は、重ねると 1 つにつながる
// （重なった部分が抜けないよう、すべて時計回りに揃えている）。

export const STICKER_VIEWBOX = 100;

export type StickerPart = {
  d: string;
  /** 指定があれば、その色で描く（顔のパーツなど）。なければ、来場者が選んだ色 */
  color?: string;
};

export type Sticker = { id: string; label: string; parts: readonly StickerPart[] };

const round = (value: number): number => Number(value.toFixed(2));

/** 多角形。点は、時計回りに並べる */
function polygon(points: readonly (readonly [number, number])[]): string {
  return `${points.map(([x, y], index) => `${index === 0 ? "M" : "L"}${round(x)} ${round(y)}`).join(" ")} Z`;
}

/** 星。いちばん上の先から、時計回りに作る。tips が 4 ならきらめき */
function star(cx: number, cy: number, outer: number, inner: number, tips: number): string {
  const points: [number, number][] = [];
  for (let index = 0; index < tips * 2; index++) {
    const radius = index % 2 === 0 ? outer : inner;
    const angle = -Math.PI / 2 + (index * Math.PI) / tips;
    points.push([cx + radius * Math.cos(angle), cy + radius * Math.sin(angle)]);
  }
  return polygon(points);
}

/** 楕円。左の点から、時計回りに描く */
function ellipse(cx: number, cy: number, rx: number, ry: number): string {
  return `M${round(cx - rx)} ${round(cy)} a${rx} ${ry} 0 1 1 ${round(2 * rx)} 0 a${rx} ${ry} 0 1 1 ${round(-2 * rx)} 0 Z`;
}

const FACE = "#2b2328";
const CENTER = "#ffd93d";

const petals = [0, 1, 2, 3, 4]
  .map((index) => {
    const angle = -Math.PI / 2 + (index * 2 * Math.PI) / 5;
    return ellipse(50 + 28 * Math.cos(angle), 50 + 28 * Math.sin(angle), 21, 21);
  })
  .join(" ");

export const STICKERS: readonly Sticker[] = [
  {
    id: "heart",
    label: "ハート",
    parts: [
      {
        d: "M50 90 C18 64 6 46 6 31 C6 17 17 8 29 8 C38 8 46 13 50 22 C54 13 62 8 71 8 C83 8 94 17 94 31 C94 46 82 64 50 90 Z",
      },
    ],
  },
  { id: "star", label: "ほし", parts: [{ d: star(50, 53, 47, 20, 5) }] },
  { id: "sparkle", label: "きらきら", parts: [{ d: star(50, 50, 48, 12, 4) }] },
  {
    id: "flower",
    label: "はな",
    parts: [{ d: petals }, { d: ellipse(50, 50, 13, 13), color: CENTER }],
  },
  {
    id: "cloud",
    label: "くも",
    parts: [
      {
        d: [
          ellipse(30, 64, 22, 18),
          ellipse(54, 46, 26, 24),
          ellipse(76, 64, 20, 17),
          "M30 64 H76 V82 H30 Z",
        ].join(" "),
      },
    ],
  },
  {
    id: "smile",
    label: "にこにこ",
    parts: [
      { d: ellipse(50, 50, 46, 46) },
      { d: ellipse(35, 42, 5, 7), color: FACE },
      { d: ellipse(65, 42, 5, 7), color: FACE },
      { d: "M27 58 Q50 86 73 58 Q50 70 27 58 Z", color: FACE },
    ],
  },
  {
    id: "crown",
    label: "おうかん",
    parts: [
      {
        d: polygon([
          [10, 82],
          [6, 30],
          [30, 52],
          [50, 16],
          [70, 52],
          [94, 30],
          [90, 82],
        ]),
      },
    ],
  },
  {
    id: "note",
    label: "おんぷ",
    parts: [
      {
        d: "M36 12 L86 4 L86 60 A14 12 0 1 1 78 50 L78 22 L44 28 L44 70 A14 12 0 1 1 36 60 Z",
      },
    ],
  },
  {
    id: "paw",
    label: "にくきゅう",
    parts: [
      {
        d: "M50 50 C30 50 20 66 24 80 C28 92 42 88 50 88 C58 88 72 92 76 80 C80 66 70 50 50 50 Z",
      },
      { d: ellipse(22, 42, 9, 12) },
      { d: ellipse(40, 26, 9, 12) },
      { d: ellipse(60, 26, 9, 12) },
      { d: ellipse(78, 42, 9, 12) },
    ],
  },
  {
    id: "bow",
    label: "リボン",
    parts: [
      {
        d: [
          polygon([
            [50, 50],
            [6, 80],
            [6, 20],
          ]),
          polygon([
            [50, 50],
            [94, 20],
            [94, 80],
          ]),
          ellipse(50, 50, 12, 15),
        ].join(" "),
      },
    ],
  },
];

export function findSticker(id: string): Sticker | undefined {
  return STICKERS.find((sticker) => sticker.id === id);
}
