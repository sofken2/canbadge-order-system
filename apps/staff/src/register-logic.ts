import { type OrderStatus, orderIdSchema, orderStatusLabels } from "@canbadge/shared";

// レジ画面の、画面から切り離した判定と計算（テストできるように）。

export type RegisterInput =
  | { kind: "empty" }
  /** QR の中身（注文 ID） */
  | { kind: "order-id"; value: string }
  /** 注文番号（当日の営業日の） */
  | { kind: "number"; value: string }
  | { kind: "invalid"; text: string };

/**
 * 入力の判定。QR の読み取りも、番号の入力も、ハンディスキャナーの読み取りも、同じ入力として扱う。
 * 注文 ID の形なら ID、数字だけなら注文番号。全角の数字・英字（スマホの入力）も、半角として読む
 */
export function parseRegisterInput(raw: string): RegisterInput {
  const text = raw.normalize("NFKC").trim();
  if (text === "") return { kind: "empty" };
  const upper = text.toUpperCase();
  if (orderIdSchema.safeParse(upper).success) return { kind: "order-id", value: upper };
  if (/^\d{1,6}$/.test(text)) return { kind: "number", value: text };
  return { kind: "invalid", text };
}

/** お釣りと、不足。受け取り額が足りないときは、お釣りが 0 で、不足の額が出る */
export function changeFor(
  totalAmount: number,
  received: number,
): { change: number; short: number } {
  const difference = received - totalAmount;
  return difference >= 0 ? { change: difference, short: 0 } : { change: 0, short: -difference };
}

/** お札の候補（円）。レジでよく出てくるもの */
const BILLS = [1000, 2000, 5000, 10000] as const;

/**
 * 受け取り額のボタン。金額以上の、いちばん近いお札から 3 つ（ちょうどは、別のボタン）。
 * 例：300円 → 1,000・2,000・5,000。1,500円 → 2,000・5,000・10,000
 */
export function receivedChoices(totalAmount: number): number[] {
  return BILLS.filter((bill) => bill > totalAmount).slice(0, 3);
}

/** 支払いを受けられない状態のとき、画面に出す説明（してほしいことつき） */
export function notPayableMessage(status: OrderStatus, orderNumberText: string): string {
  const label = orderStatusLabels[status];
  switch (status) {
    case "submitted":
      return "";
    case "cancelled":
    case "expired":
    case "refunded":
      return `注文 ${orderNumberText} は「${label}」のため、支払いを受けられません。お客さんに、状況を伝えてください。`;
    default:
      return `注文 ${orderNumberText} は、すでに支払い済みです（いまの状態：${label}）。`;
  }
}

/** 取り消せる時間の、残りの秒数（切り上げ）。0 以下になったら 0 */
export function secondsLeft(deadline: number, now: number): number {
  return Math.max(0, Math.ceil((deadline - now) / 1000));
}
