import type { ArchiveEntryView } from "@canbadge/shared";

// アーカイブの閲覧・通報（W05）。画面の計算の部分。

/** 一覧を 1 回に読む件数。サムネイルは軽いが、スマホで一度に出しすぎない */
export const PAGE_SIZE = 24;

/**
 * 続きのページを、いまの一覧に足す。ID で重複を除く
 * （「もっと見る」を読み込んでいる間に、新しい作品が公開されて、ページの境目で、同じ作品が 2 回出ないように）
 */
export function appendPage(
  current: readonly ArchiveEntryView[],
  next: readonly ArchiveEntryView[],
): ArchiveEntryView[] {
  const seen = new Set(current.map((entry) => entry.id));
  return [...current, ...next.filter((entry) => !seen.has(entry.id))];
}

export const REPORT_REASON_MAX = 500;

/** 通報の理由が、送ってよいか。送れないときは、その理由（画面に出す文） */
export function reportProblem(reason: string): string | undefined {
  const text = reason.trim();
  if (text === "") return "どこが問題か、短く書いてください";
  if (text.length > REPORT_REASON_MAX) return `${REPORT_REASON_MAX} 文字までで、書いてください`;
  return undefined;
}

export const reportedMessage =
  "通報しました。スタッフが、確認します。ご協力、ありがとうございます。";

/** 詳細が開けなかったとき。取り下げられた作品も、同じ文（作品があったことも、教えない） */
export const entryNotFoundMessage =
  "この作品は、見つかりません。取り下げられたか、まだ公開されていないかもしれません。";

/** 作品の表示名の見出し（「たろう さんの作品」） */
export function authorLine(displayName: string): string {
  return `${displayName} さんの作品`;
}

/** 注文できない理由。注文できるなら undefined。受付の状態と、作品の状態から決める */
export function orderBlockedReason(input: {
  accepting: boolean;
  busyMessage: string | null | undefined;
  entryStatus: string;
}): string | undefined {
  if (input.entryStatus !== "public") return "この作品は、いま、注文できません";
  if (!input.accepting) return input.busyMessage ?? "現在、注文を受け付けていません。";
  return undefined;
}

/**
 * 作品からの注文が失敗したときの文。作品が、注文している間に取り下げられた（見つからない）ときは、
 * 理由が分かる文にする。それ以外は、api の文（日本語で、そのまま出せる）を使う
 */
export function orderErrorMessage(message: string): string {
  return message.includes("見つかりません")
    ? "この作品は、いま、注文できません。取り下げられたかもしれません。みんなの作品に戻って、ほかの作品を、見てみてください。"
    : message;
}
