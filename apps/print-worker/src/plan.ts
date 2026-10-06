// 次に印刷するシートの、組み立て（P02）。画面もデータベースも使わない、純粋な計算。
// 「どのバッジを、どの順で、何個載せるか」「いま印刷するか、待つか」を決める。

/** 印刷できるバッジ 1 個分（listPrintableItems の一部） */
export type Candidate = {
  orderItemId: string;
  /** 用紙に並べる個数（同じバッジを、並べて印刷する） */
  quantity: number;
  /** 印刷待ちになった時刻（ISO）。待った時間の判断に使う */
  waitingSince: string;
};

export type Plan<T extends Candidate> =
  /** 載せられるバッジがない */
  | { status: "empty" }
  /** 用紙 1 枚分に足りず、いちばん古いバッジも、まだ待ち時間に達していない */
  | { status: "waiting"; used: number; capacity: number; waitedSeconds: number }
  /** 印刷する。copies は、batch の各バッジを、用紙に何個並べるか */
  | { status: "print"; batch: T[]; copies: number[]; used: number };

/**
 * 候補（優先する順に並んでいる：再印刷が先、次に待った順）から、1 枚分を選ぶ。
 *
 * - 先頭から順に、残りの枠に収まるバッジを載せる。**個数が残りの枠に収まらないバッジは、載せずに次のシートに回す**
 *   （1 つのバッジを、複数のシートに分けない）。その後ろの、収まるバッジは、載せてよい（枠を余らせない）。
 *   次のシートでは、回されたバッジが先頭に来るので、後回しが続くことはない
 * - 枠がすべて埋まったら、すぐ印刷する。埋まらなくても、載せたバッジのうち**いちばん古いものが**
 *   waitSeconds 待ったら、そのときの分で印刷する
 * - 1 枚の枠より多い個数のバッジは、どのシートにも載らないので、選ばない（呼ぶ側が、先に外す）
 */
export function planSheet<T extends Candidate>(
  candidates: readonly T[],
  options: { capacity: number; waitSeconds: number; nowMs: number },
): Plan<T> {
  const batch: T[] = [];
  const copies: number[] = [];
  let used = 0;
  for (const candidate of candidates) {
    if (candidate.quantity > options.capacity - used) continue;
    batch.push(candidate);
    copies.push(candidate.quantity);
    used += candidate.quantity;
    if (used === options.capacity) break;
  }
  if (batch.length === 0) return { status: "empty" };

  const oldest = Math.min(...batch.map((item) => new Date(item.waitingSince).getTime()));
  const waitedSeconds = Math.max(0, (options.nowMs - oldest) / 1000);
  if (used < options.capacity && waitedSeconds < options.waitSeconds) {
    return { status: "waiting", used, capacity: options.capacity, waitedSeconds };
  }
  return { status: "print", batch, copies, used };
}
