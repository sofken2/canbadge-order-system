import { z } from "zod";

// 負荷テストの設定（Q04）。コマンドの引数から作る。既定値は、「学祭の 1 時間の山」の想定の、たたき台。
// 人の作業時間は、**仮想の秒**（実際の運用での秒）で決める。speed 倍の速さで進めるので、実際の待ちは短い。

const positive = z.coerce.number().positive();
const nonNegative = z.coerce.number().min(0);
const count = z.coerce.number().int().min(0);

export const loadConfigSchema = z.object({
  /** 来場者の数（注文の数） */
  visitors: z.coerce.number().int().positive().default(120),
  /** 全員が来終わるまでの時間（仮想の分）。この間に、ばらばらに（指数分布の間隔で）来る */
  arrivalMinutes: positive.default(20),
  /** 時間の圧縮。30 なら、仮想の 60 分が実際の 2 分。サーバーへの負荷も、その分、濃くなる */
  speed: positive.default(30),
  /** 全員が来終わったあと、片づくまで待つ、最大の時間（仮想の分）。超えたら、そこで止めて、残りを報告する */
  drainMinutes: positive.default(45),

  /** 注文してから、ブースに着くまでの時間（仮想の秒）の、最短と最長 */
  walkMinSeconds: nonNegative.default(15),
  walkMaxSeconds: nonNegative.default(90),

  /** レジ係の人数と、1 人あたりの作業時間（秒） */
  cashiers: count.default(2),
  cashierServiceSeconds: positive.default(25),

  /** 用紙 1 枚の、プリンターが印刷する時間（秒）。印刷中のシートは同時に 1 枚なので、処理能力の上限になる */
  printSeconds: nonNegative.default(45),
  /** 印刷を待つ最大の時間（仮想の秒）。api の printMaxWaitSeconds に当たる */
  printMaxWaitSeconds: positive.default(60),
  /** 組み立てで、印刷の不良に気づいて、履歴から再印刷するバッジの割合（0〜1） */
  reprintRate: z.coerce.number().min(0).max(1).default(0.03),

  /** 組み立て係の人数と、バッジ 1 個あたりの作業時間（秒）。多くの場合、ここが、ボトルネック */
  assemblers: count.default(3),
  assembleServiceSeconds: positive.default(100),

  /** 受け渡し係の人数と、1 人あたりの作業時間（秒） */
  pickupStaff: count.default(1),
  pickupServiceSeconds: positive.default(20),
  /** できあがりを知ってから、受け取りに来るまでの時間（仮想の秒）の、最短と最長 */
  pickupMinDelaySeconds: nonNegative.default(30),
  pickupMaxDelaySeconds: nonNegative.default(300),
  /** 確認コードを、最初に打ち間違える来場者の割合（0〜1） */
  mistypeRate: z.coerce.number().min(0).max(1).default(0.02),

  /** 乱数の種。同じ種なら、同じ客・同じ作業時間で、再現できる */
  seed: z.coerce.number().int().default(1),
  /** 結果の JSON を書き出す場所（省略すると、書き出さない） */
  out: z.string().optional(),
  /** 既に動いている api に対して流す（省略すると、一時的な api と print-worker を起動する）。スタッフ用の API が使えない経路では、動かない */
  target: z.string().url().optional(),
  /** --target で、動いているサーバーに、テストの注文を書き込むことを、了解した（本番のサーバーには、流さない） */
  yesWriteToTarget: z.boolean().default(false),
});

export type LoadConfig = z.infer<typeof loadConfigSchema>;

/** `--visitors 100 --speed=60` のような引数を、設定にする。知らない名前・値の誤りは、分かる文で断る */
export function parseArgs(argv: readonly string[]): LoadConfig {
  const raw: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] ?? "";
    if (!arg.startsWith("--")) throw new Error(`引数の形が正しくありません: ${arg}`);
    const [name, inline] = arg.slice(2).split("=", 2);
    if (!name) throw new Error(`引数の形が正しくありません: ${arg}`);
    const key = name.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
    if (!(key in loadConfigSchema.shape)) throw new Error(`知らない引数です: --${name}`);
    // 値のない引数（旗）
    if (key === "yesWriteToTarget") {
      raw[key] = true;
      continue;
    }
    const value = inline ?? argv[++i];
    if (value === undefined) throw new Error(`--${name} に、値がありません`);
    raw[key] = value;
  }
  const parsed = loadConfigSchema.safeParse(raw);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    throw new Error(`引数が正しくありません: --${String(first?.path[0])}（${first?.message}）`);
  }
  const config = parsed.data;
  if (config.walkMinSeconds > config.walkMaxSeconds) {
    throw new Error("--walk-min-seconds は、--walk-max-seconds 以下にしてください");
  }
  if (config.pickupMinDelaySeconds > config.pickupMaxDelaySeconds) {
    throw new Error("--pickup-min-delay-seconds は、--pickup-max-delay-seconds 以下にしてください");
  }
  if (config.target && !config.yesWriteToTarget) {
    throw new Error(
      "--target は、動いているサーバーに、テストの注文（と営業開始）を書き込みます。本番のサーバーには、流さないでください。了解したら、--yes-write-to-target を付けてください",
    );
  }
  if (config.cashiers < 1 || config.assemblers < 1 || config.pickupStaff < 1) {
    throw new Error("レジ・組み立て・受け渡しは、それぞれ 1 人以上にしてください");
  }
  return config;
}

export const HELP = `負荷テスト（Q04）：模擬の来場者とスタッフを動かして、1 時間あたりの処理能力と、詰まる所を測る。

使い方（packages/e2e で）:
  bun run load                          既定の設定（120 人・20 分・組み立て 3 人）で流す
  bun run load --visitors 200 --assemblers 4 --out report.json

主な引数（値は、仮想の秒・分。実際の運用での時間）:
  --visitors N                来場者の数（120）
  --arrival-minutes M         全員が来終わるまで（20）
  --speed S                   時間の圧縮。30 なら、仮想の 60 分が実際の 2 分（30）
  --cashiers N / --cashier-service-seconds S             レジ（2 人・25 秒）
  --assemblers N / --assemble-service-seconds S          組み立て（3 人・100 秒）
  --pickup-staff N / --pickup-service-seconds S          受け渡し（1 人・20 秒）
  --print-seconds S                                      印刷 1 枚（45 秒）
  --print-max-wait-seconds S  印刷を待つ最大の時間（60）
  --reprint-rate R            再印刷の割合（0.03）
  --seed N                    乱数の種（1）。同じ種なら、同じ客で再現できる
  --out FILE                  結果を JSON で書き出す
  --target URL                動いている api に流す（省略すると、一時的な api を起動する）。
                              テストの注文が、そのサーバーに残る。**本番には流さない**。--yes-write-to-target が要る
  --help                      この説明
`;
