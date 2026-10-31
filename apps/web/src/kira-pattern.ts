// キラフィルムの柄。注文に記録され（契約の kiraPattern）、在庫は柄ごとに数える。
// 柄の名前は、契約の kiraPatternLabels だけで持つ。

import {
  type KiraPattern,
  kiraPatternLabels,
  kiraPatternSchema,
  type StatusResponse,
} from "@canbadge/shared";

export type { KiraPattern };

export const KIRA_PATTERNS: readonly { id: KiraPattern; label: string }[] =
  kiraPatternSchema.options.map((id) => ({ id, label: kiraPatternLabels[id] }));

/** 柄ごとの、在庫の残り */
export type KiraRemaining = Record<KiraPattern, number>;

export function kiraRemainingOf(
  status: Pick<StatusResponse, "kiraShardsRemaining" | "kiraAuroraRemaining"> | undefined,
): KiraRemaining | undefined {
  if (!status) return undefined;
  return { shards: status.kiraShardsRemaining, aurora: status.kiraAuroraRemaining };
}

/**
 * 選んでいる柄を、残りのある柄にそろえる。選んだ柄が売り切れなら、残りのある別の柄に替える
 * （どちらも売り切れなら、そのまま。画面は、キラフィルムを売り切れとして出す）。残りが読めないあいだは、そのまま
 */
export function usablePattern(
  wanted: KiraPattern,
  remaining: KiraRemaining | undefined,
): KiraPattern {
  if (!remaining || remaining[wanted] > 0) return wanted;
  return KIRA_PATTERNS.find((pattern) => remaining[pattern.id] > 0)?.id ?? wanted;
}
