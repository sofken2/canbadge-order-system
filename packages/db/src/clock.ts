import type { Clock } from "./connection";

/**
 * 手で進められる時計。テストやサンプルデータで、操作の時刻（操作ログ・支払いの時刻など）を
 * 決めた値にするために使う。openDatabase の now に渡す
 */
export function createManualClock(startIso: string): {
  now: Clock;
  set: (iso: string) => void;
  advance: (ms: number) => void;
} {
  let current = new Date(startIso).getTime();
  if (Number.isNaN(current)) throw new Error(`時刻が正しくありません: ${startIso}`);
  return {
    now: () => new Date(current),
    set: (iso) => {
      current = new Date(iso).getTime();
    },
    advance: (ms) => {
      current += ms;
    },
  };
}
