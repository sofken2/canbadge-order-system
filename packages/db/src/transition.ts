import type { Actor, Transition } from "@canbadge/shared";
import { invalidTransition } from "./errors";

const actorLabels: Record<Actor, string> = {
  staff: "スタッフ",
  visitor: "来場者",
  system: "システム",
};

/**
 * 遷移表から、from → to の行を探す。表にない遷移と、その役割ができない遷移は断る。
 * 遷移表は packages/shared にデータとしてあり、ここは照合するだけ
 */
export function findTransition<S extends string>(
  table: readonly Transition<S>[],
  labels: Record<S, string>,
  input: { from: S; to: S; actor: Actor },
): Transition<S> {
  const row = table.find((r) => r.from === input.from && r.to === input.to);
  if (!row) {
    throw invalidTransition(
      `「${labels[input.from]}」から「${labels[input.to]}」には変更できません`,
      { from: input.from, to: input.to },
    );
  }
  if (!row.actors.includes(input.actor)) {
    throw invalidTransition(
      `「${labels[input.from]}」から「${labels[input.to]}」への変更は、${actorLabels[input.actor]}にはできません`,
      { from: input.from, to: input.to, actor: input.actor },
    );
  }
  return row;
}
