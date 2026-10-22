import type { OrderStatus } from "@canbadge/shared";

// 注文状況ページの、状態ごとの見せ方。画面から切り離した、純粋な関数（テストできるように）。

/** 進み具合の段階。注文 → お支払い → 印刷 → 組み立て → できあがり → 受け取り（来場者の言い方にそろえる） */
export const PROGRESS_STEPS = [
  "注文した",
  "お支払い",
  "印刷",
  "組み立て",
  "できあがり",
  "受け取り",
] as const;

/**
 * いま、どの段階か（PROGRESS_STEPS の番号）。これより前の段階は、済んでいる。
 * 受け渡し済みは、全部の段階が済んだことを表す番号（段階の数）を返す。
 * 取り消し・期限切れ・返金は、進み具合の途中ではないので、undefined（進み具合を出さない）
 */
export function progressIndex(status: OrderStatus): number | undefined {
  switch (status) {
    case "submitted":
      return 1;
    case "paid":
      return 2;
    case "printed":
    case "assembling":
      return 3;
    case "ready":
      return 4;
    case "picked_up":
      return PROGRESS_STEPS.length;
    default:
      return undefined;
  }
}

export type StepState = "done" | "now" | "todo";

export function stepState(index: number, current: number): StepState {
  if (index < current) return "done";
  return index === current ? "now" : "todo";
}

/** 画面の調子。action はお客さんにしてほしいことがあるとき、ready はできあがり */
export type GuideTone = "waiting" | "action" | "ready" | "done" | "stopped";

export type Guide = { headline: string; body: string; tone: GuideTone };

/** 状態ごとの、見出しと案内。お客さんが、次に何をすればよいかが、わかるように書く */
export function guideFor(
  status: OrderStatus,
  order: { totalAmount: number; confirmationCode: string },
): Guide {
  switch (status) {
    case "submitted":
      return {
        headline: "レジでお支払いをお願いします",
        body: `ブースのレジで、この画面の QR を見せて、${order.totalAmount}円をお支払いください。`,
        tone: "action",
      };
    case "paid":
      return {
        headline: "お支払いありがとうございます",
        body: "いま、順番に印刷しています。できあがりまで、少しお待ちください。",
        tone: "waiting",
      };
    case "printed":
      return {
        headline: "印刷ができました",
        body: "これから、ひとつずつ手作業で組み立てます。",
        tone: "waiting",
      };
    case "assembling":
      return {
        headline: "組み立てています",
        body: "もうすぐです。ブースの近くで、お待ちください。",
        tone: "waiting",
      };
    case "ready":
      return {
        headline: "できあがりました！",
        body: `ブースの受け取り口で、確認コード「${order.confirmationCode}」を伝えてください。`,
        tone: "ready",
      };
    case "picked_up":
      return {
        headline: "お渡ししました",
        body: "ご注文ありがとうございました。",
        tone: "done",
      };
    case "expired":
      return {
        headline: "お支払いの期限が過ぎました",
        body: "支払いの前に受付が終わったため、この注文は無効になりました。もう一度注文するか、ブースのスタッフにお声がけください。",
        tone: "stopped",
      };
    case "cancelled":
      return {
        headline: "この注文は取り消されました",
        body: "ご不明な点は、ブースのスタッフにお声がけください。",
        tone: "stopped",
      };
    case "refunded":
      return {
        headline: "代金をお返ししました",
        body: "ご不明な点は、ブースのスタッフにお声がけください。",
        tone: "stopped",
      };
  }
}

/** QR を出す状態。レジ・受け渡しの対応が続いている間だけ。済んだ・止まった注文には出さない */
export function showsQr(status: OrderStatus): boolean {
  return progressIndex(status) !== undefined && status !== "picked_up";
}

/** できあがりの知らせ（振動・タブの表題）を出すか。前の状態から、ready に変わった瞬間だけ */
export function justBecameReady(previous: OrderStatus | undefined, next: OrderStatus): boolean {
  return previous !== undefined && previous !== "ready" && next === "ready";
}
