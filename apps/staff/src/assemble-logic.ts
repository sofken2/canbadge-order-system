import {
  CONFIRMATION_CODE_ALPHABET,
  CONFIRMATION_CODE_LENGTH,
  type OrderStatus,
  orderStatusLabels,
  type StaffOrderView,
} from "@canbadge/shared";

// 組み立て・受け渡し画面の、画面から切り離した判定と計算（テストできるように）。

/** できあがりから、この分数をこえたら、「長くお待ちです」として目立たせる（暫定。Q01 で、現場に合わせて決める） */
export const LONG_WAIT_MINUTES = 10;
/** さらに、この分数をこえたら、強く目立たせる */
export const VERY_LONG_WAIT_MINUTES = 20;

export type Urgency = "normal" | "long" | "very-long";

/** 時刻（ISO）から、いままでの経過分（切り捨て）。時刻がなければ undefined。未来の時刻は 0 */
export function minutesSince(iso: string | undefined, now: number): number | undefined {
  if (!iso) return undefined;
  const at = Date.parse(iso);
  if (Number.isNaN(at)) return undefined;
  return Math.max(0, Math.floor((now - at) / 60000));
}

export function urgencyOf(minutes: number | undefined): Urgency {
  if (minutes === undefined) return "normal";
  if (minutes >= VERY_LONG_WAIT_MINUTES) return "very-long";
  return minutes >= LONG_WAIT_MINUTES ? "long" : "normal";
}

/** 「3 分」「1 時間 5 分」のように、読みやすくする */
export function formatWait(minutes: number): string {
  if (minutes < 60) return `${minutes} 分`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours} 時間` : `${hours} 時間 ${rest} 分`;
}

export type Grouped = {
  /** 印刷済み・組み立て待ち。番号の小さい（古い）順 */
  toAssemble: StaffOrderView[];
  /** 組み立て中。番号の小さい順 */
  assembling: StaffOrderView[];
  /** できあがり・受け取り待ち。できあがりが古い（長く待っている）順 */
  ready: StaffOrderView[];
};

export function groupOrders(items: readonly StaffOrderView[]): Grouped {
  const byNumber = (a: StaffOrderView, b: StaffOrderView) => a.orderNumber - b.orderNumber;
  const byReady = (a: StaffOrderView, b: StaffOrderView) =>
    (a.readyAt ?? "").localeCompare(b.readyAt ?? "") || byNumber(a, b);
  return {
    toAssemble: items.filter((order) => order.status === "printed").sort(byNumber),
    assembling: items.filter((order) => order.status === "assembling").sort(byNumber),
    ready: items.filter((order) => order.status === "ready").sort(byReady),
  };
}

/**
 * 確認コードの入力を、整える。全角・小文字を直し、使わない文字（0 O 1 I L と記号・空白）は捨てる。
 * 4 文字までで切る。正しいかどうかの照合は、api が行う（ここは、入力の整形だけ）
 */
export function normalizeConfirmationCode(raw: string): string {
  const allowed = new Set(CONFIRMATION_CODE_ALPHABET);
  return [...raw.normalize("NFKC").toUpperCase()]
    .filter((char) => allowed.has(char))
    .slice(0, CONFIRMATION_CODE_LENGTH)
    .join("");
}

export const isCompleteCode = (code: string): boolean => code.length === CONFIRMATION_CODE_LENGTH;

/** 受け渡しできない状態のとき、画面に出す説明（してほしいことつき）。受け渡せる（ready）なら、空 */
export function notPickableMessage(status: OrderStatus, orderNumberText: string): string {
  const label = orderStatusLabels[status];
  switch (status) {
    case "ready":
      return "";
    case "picked_up":
      return `注文 ${orderNumberText} は、すでに受け渡し済みです。`;
    case "submitted":
      return `注文 ${orderNumberText} は、まだ支払いが済んでいません。レジで、支払いをお願いしてください。`;
    case "paid":
    case "printed":
    case "assembling":
      return `注文 ${orderNumberText} は、まだできあがっていません（いまの状態：${label}）。もう少し、お待ちいただいてください。`;
    default:
      return `注文 ${orderNumberText} は「${label}」のため、受け渡しできません。スタッフに、お声がけください。`;
  }
}
