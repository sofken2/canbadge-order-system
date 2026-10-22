// キラフィルムの柄。契約（注文）に柄の項目がまだないので、注文には記録できない。
// それまでのつなぎとして、注文の確定のときに、同じタブの中（sessionStorage）に注文 ID ごとに残し、
// 注文状況の画面で「選んだ柄（レジでお伝えください）」として見せる。契約に入ったら、注文に載せてここは消す。
// sessionStorage が使えなくても（プライベートモードなど）、画面は動く（柄の表示が、出ないだけ）。

import type { BadgeFilm } from "@canbadge/editor";
import { sessionStore } from "./browser-storage";

export type KiraPattern = Exclude<BadgeFilm, "none">;

export const KIRA_PATTERNS: readonly { id: KiraPattern; label: string }[] = [
  { id: "shards", label: "割れガラス" },
  { id: "aurora", label: "オーロラ" },
];

export function kiraPatternLabel(pattern: KiraPattern): string {
  return KIRA_PATTERNS.find((item) => item.id === pattern)?.label ?? pattern;
}

const keyFor = (orderId: string) => `canbadge-kira-pattern:${orderId}`;

export function saveKiraPattern(
  orderId: string,
  pattern: KiraPattern,
  storage: Pick<Storage, "setItem"> = sessionStore(),
) {
  try {
    storage.setItem(keyFor(orderId), pattern);
  } catch {
    // 保存できなくても、注文はできている（柄の表示が、出ないだけ）
  }
}

/** この注文で選んだ柄。なければ・知らない値なら undefined */
export function readKiraPattern(
  orderId: string,
  storage: Pick<Storage, "getItem"> = sessionStore(),
): KiraPattern | undefined {
  try {
    const raw = storage.getItem(keyFor(orderId));
    return KIRA_PATTERNS.find((item) => item.id === raw)?.id;
  } catch {
    return undefined;
  }
}
