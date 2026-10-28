import { REPRINT_WAIT_RATIO } from "@canbadge/badge-spec";

// 次に印刷するシートの、組み立て（P02）。画面もデータベースも使わない、純粋な計算。
// 「どのバッジを、どの順で、何個載せるか」「いま印刷するか、待つか」を決める。

/** 印刷できるバッジ 1 個分（listPrintableItems の一部） */
export type Candidate = {
  orderItemId: string;
  /** 用紙に並べる個数（同じバッジを、並べて印刷する） */
  quantity: number;
  /** 印刷待ちになった時刻（ISO）。待った時間の判断に使う。再印刷のバッジは、やり直しになった時刻（支払いの時刻ではない） */
  waitingSince: string;
  /** 再印刷のバッジ（印刷したが、やり直しになったもの）。ほかのバッジより先に載り、待ち時間は、短い */
  reprint?: boolean;
};

export { REPRINT_WAIT_RATIO };

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
 * - 枠がすべて埋まったら、すぐ印刷する。埋まらなくても、載せたバッジのどれかが、待ち時間に達したら、そのときの分で印刷する。
 *   待ち時間は、ふつうのバッジが waitSeconds、**再印刷のバッジは、その半分**（REPRINT_WAIT_RATIO）。
 *   再印刷が先に載り、残りの枠に、印刷待ちのバッジが、そろっていれば、一緒に載る（再印刷のためだけに、ほぼ空の用紙を出さない）
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

  // 載せたバッジのうち、待ち時間に達したものが、1 つでもあれば、印刷する。待った時間の長さは、報告用に、最長を返す
  const waitedOf = (item: T) =>
    Math.max(0, (options.nowMs - new Date(item.waitingSince).getTime()) / 1000);
  const limitOf = (item: T) =>
    item.reprint ? options.waitSeconds * REPRINT_WAIT_RATIO : options.waitSeconds;
  const due = batch.some((item) => waitedOf(item) >= limitOf(item));
  if (used < options.capacity && !due) {
    return {
      status: "waiting",
      used,
      capacity: options.capacity,
      waitedSeconds: Math.max(...batch.map(waitedOf)),
    };
  }
  return { status: "print", batch, copies, used };
}
