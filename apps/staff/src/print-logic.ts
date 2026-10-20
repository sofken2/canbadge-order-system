import {
  type OrderStatus,
  orderStatusLabels,
  type PrintSlotResult,
  type StaffOrderView,
} from "@canbadge/shared";

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
    : `${done} 個を、印刷待ちに戻しました。印刷待ちのバッジと一緒に、次のシートで印刷します（少し待つことがあります）`;
}

// ---- 印刷待ち（支払い済みで、まだ印刷されていないバッジ）の見える化 ----
// print-worker の決まり（P02）に合わせる：用紙 1 枚分たまるか、最も古いバッジが待ち時間に達したら、印刷する。
// 再印刷は先に出る。同時に印刷するのは 1 枚だけで、いまのシートの確認（OK）が済むまで、次のシートは出ない。

/** 印刷待ちの 1 注文。支払い済みの注文の、印刷待ち（queued）の明細を、まとめたもの */
export type QueueEntry = {
  orderId: string;
  orderNumberText: string;
  thumbnailUrl: string | undefined;
  /** 印刷待ちの個数 */
  badges: number;
  /** 再印刷（先に印刷される）。印刷したことのある明細を含む */
  reprint: boolean;
  /** 支払いの時刻。待ち時間の起点 */
  paidAt: string | undefined;
};

/** 支払い済みの注文から、印刷待ちの一覧を作る。待たせている順（古いものから） */
export function toQueueEntries(orders: readonly StaffOrderView[]): QueueEntry[] {
  const entries: QueueEntry[] = [];
  for (const order of orders) {
    if (order.status !== "paid") continue;
    const queued = order.items.filter((item) => item.status === "queued");
    if (queued.length === 0) continue;
    entries.push({
      orderId: order.id,
      orderNumberText: order.orderNumberText,
      thumbnailUrl: queued[0]?.thumbnailUrl,
      badges: queued.reduce((sum, item) => sum + item.quantity, 0),
      reprint: queued.some((item) => item.printCount > 0),
      paidAt: order.paidAt,
    });
  }
  return entries.sort((a, b) => Date.parse(a.paidAt ?? "") - Date.parse(b.paidAt ?? ""));
}

export const queueBadgeCount = (entries: readonly QueueEntry[]): number =>
  entries.reduce((sum, entry) => sum + entry.badges, 0);

/**
 * 最も古い（再印刷でない）バッジが、待ち時間に達するまでの秒数。0 以上。
 * 再印刷だけのときは、待ち時間の起点が、画面からは分からないので undefined
 */
export function secondsUntilPrint(
  entries: readonly QueueEntry[],
  waitSeconds: number,
  now: number,
): number | undefined {
  const firsts = entries.filter((entry) => !entry.reprint && entry.paidAt !== undefined);
  if (firsts.length === 0) return undefined;
  const oldest = Math.min(...firsts.map((entry) => Date.parse(entry.paidAt ?? "")));
  if (Number.isNaN(oldest)) return undefined;
  return Math.max(0, Math.ceil((oldest + waitSeconds * 1000 - now) / 1000));
}

/** 「1 分 5 秒」のように読みやすく（秒の単位まで） */
export function formatSeconds(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  if (seconds < 60) return `${seconds} 秒`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return rest === 0 ? `${minutes} 分` : `${minutes} 分 ${rest} 秒`;
}

/** 支払いから、いままでの待ち時間。時刻が読めなければ、空 */
export function waitedSeconds(paidAt: string | undefined, now: number): number | undefined {
  if (!paidAt) return undefined;
  const at = Date.parse(paidAt);
  return Number.isNaN(at) ? undefined : Math.max(0, Math.floor((now - at) / 1000));
}

export type QueueState = {
  headline: string;
  /** 次に何が起きるか。印刷係が、待つ・押す・確認する、のどれかが、分かるように書く */
  detail: string;
  /** 印刷係が、いま、動かなくてはならないとき（シートの確認・再開） */
  needsAction: boolean;
};

export function queueState(input: {
  badges: number;
  capacity: number;
  paused: boolean;
  /** 印刷中（確認待ち）のシートがあるか */
  printing: boolean;
  secondsLeft: number | undefined;
}): QueueState {
  const { badges, capacity } = input;
  if (input.paused) {
    return {
      headline: `印刷待ち ${badges} 個（印刷を止めています）`,
      detail: "「印刷を再開する」を押すと、印刷待ちのバッジが、印刷されます。",
      needsAction: true,
    };
  }
  if (badges === 0) {
    return {
      headline: "印刷待ちは、ありません",
      detail: input.printing
        ? "印刷中のシートの確認が済むと、次の印刷に進めます。"
        : "支払いが済んだ注文が、ここに出ます。",
      needsAction: false,
    };
  }
  if (input.printing) {
    return {
      headline: `印刷待ち ${badges} 個`,
      detail:
        "印刷中のシートの確認（OK）が済むまで、次のシートは、印刷されません。「確認」タブで、用紙と見比べて、確認してください。",
      needsAction: true,
    };
  }
  if (badges >= capacity) {
    return {
      headline: `印刷待ち ${badges} 個`,
      detail: `用紙 1 枚分（${capacity} 個）たまっています。まもなく印刷されます。`,
      needsAction: false,
    };
  }
  const missing = capacity - badges;
  if (input.secondsLeft === undefined) {
    return {
      headline: `印刷待ち ${badges} 個`,
      detail: "再印刷のバッジが、先に印刷されます。少し待つことがあります。",
      needsAction: false,
    };
  }
  return {
    headline: `印刷待ち ${badges} 個`,
    detail:
      input.secondsLeft === 0
        ? "まもなく、いまある分を印刷します。"
        : `あと ${missing} 個で用紙 1 枚分です。たまらなくても、あと ${formatSeconds(input.secondsLeft)}で、いまある分を印刷します。`,
    needsAction: false,
  };
}
