import { type OrderStatus, orderStatusLabels, type PrintSlotResult } from "@canbadge/shared";

// 印刷確認画面の、画面から切り離した判定と計算（テストできるように）。

/** 再印刷の対象になる、注文の状態（spec.md 8.1：printed・assembling・ready は、paid に戻る） */
const REPRINTABLE: readonly OrderStatus[] = ["printed", "assembling", "ready"];

export const isReprintableOrderStatus = (status: OrderStatus): boolean =>
  REPRINTABLE.includes(status);

/** バッジを選ぶ・外す。もとの集合は変えない */
export function toggled<T>(selected: ReadonlySet<T>, value: T): Set<T> {
  const next = new Set(selected);
  if (next.has(value)) next.delete(value);
  else next.add(value);
  return next;
}

export type SlotChoice = Exclude<PrintSlotResult, "pending">;

/** 確認の集計。選ばなかったバッジは OK（契約：再印刷に回すバッジ以外は、すべて OK） */
export function sheetTally(
  slotIds: readonly string[],
  reprint: ReadonlySet<string>,
): { ok: number; reprint: number } {
  const reprintCount = slotIds.filter((id) => reprint.has(id)).length;
  return { ok: slotIds.length - reprintCount, reprint: reprintCount };
}

export type ReprintTarget = {
  orderItemId: string;
  orderNumber: number;
  orderNumberText: string;
  orderStatus: OrderStatus;
};

/** 注文番号の、小さい順で重複なしの一覧（確認の画面に出す） */
export function distinctNumbers(targets: readonly ReprintTarget[]): string[] {
  const byNumber = new Map<number, string>();
  for (const target of targets) byNumber.set(target.orderNumber, target.orderNumberText);
  return [...byNumber.entries()].sort((a, b) => a[0] - b[0]).map(([, text]) => text);
}

export type ImpactLine = { status: OrderStatus; numbers: string[]; text: string };

/**
 * 再印刷が、注文に与える影響の説明（実行前の確認に出す）。
 * 再印刷すると、注文は「印刷待ち」に戻り、組み立て済みのバッジも、作り直しになる
 */
export function reprintImpact(targets: readonly ReprintTarget[]): ImpactLine[] {
  const lines: ImpactLine[] = [];
  for (const status of REPRINTABLE) {
    const group = targets.filter((target) => target.orderStatus === status);
    if (group.length === 0) continue;
    const label = orderStatusLabels[status];
    const text =
      status === "ready"
        ? `「${label}」の注文が、「${orderStatusLabels.paid}」に戻ります。呼び出しモニターから、番号が消えます`
        : status === "assembling"
          ? `「${label}」の注文が、「${orderStatusLabels.paid}」に戻ります。組み立て中のバッジは、作り直しになります`
          : `「${label}」の注文が、「${orderStatusLabels.paid}」に戻ります`;
    lines.push({ status, numbers: distinctNumbers(group), text });
  }
  return lines;
}

/** 再印刷できる対象と、できない対象（受け渡し済み・取り消しなど）に分ける。できないものが 1 つでもあると api は全体を断るため、先に外す */
export function splitReprintable<T extends { orderStatus: OrderStatus }>(
  targets: readonly T[],
): { reprintable: T[]; excluded: T[] } {
  return {
    reprintable: targets.filter((target) => isReprintableOrderStatus(target.orderStatus)),
    excluded: targets.filter((target) => !isReprintableOrderStatus(target.orderStatus)),
  };
}

/** 再印刷の結果を、1 文にする */
export function reprintResultMessage(result: {
  reprintedItemIds: readonly string[];
  skippedItemIds: readonly string[];
}): string {
  const done = result.reprintedItemIds.length;
  const skipped = result.skippedItemIds.length;
  if (done === 0 && skipped > 0) return `すでに印刷待ちのため、何も変えていません（${skipped} 個）`;
  return skipped > 0
    ? `${done} 個を、印刷待ちに戻しました（すでに印刷待ちの ${skipped} 個は、そのままです）`
    : `${done} 個を、印刷待ちに戻しました。次のシートに載ります`;
}
