import { badgeSpec, slotsPerSheet } from "@canbadge/badge-spec";
import { Notice, useResource } from "@canbadge/ui";
import { useMemo } from "react";
import { api } from "./api";
import {
  formatSeconds,
  queueBadgeCount,
  queueState,
  secondsUntilPrint,
  toQueueEntries,
  waitedSeconds,
} from "./print-logic";
import { useNow } from "./useNow";

/**
 * 印刷待ち（支払い済みで、まだ印刷されていないバッジ）。印刷係が、「いま、何が待っていて、次に何が起きるか」を、
 * 見られるようにする。印刷が始まる前（最大で、設定の待ち時間）は、ここだけが手がかり。
 * 契約は、既存の注文の検索（status=paid）と、印刷中のシートを使う。SSE の通知で、取り直す
 */
export function QueuePanel({ paused, waitSeconds }: { paused: boolean; waitSeconds: number }) {
  const subscribe = (reload: () => void) =>
    api.subscribe("staffEvents", { onEvent: reload, onOpen: reload });
  const orders = useResource(
    () => api.call("searchStaffOrders", { query: { status: "paid", limit: 100 } }),
    { subscribe },
  );
  const sheet = useResource(() => api.call("getCurrentPrintSheet"), { subscribe });
  // 秒の表示（「あと ○秒」「○ 分 ○ 秒待ち」）を、1 秒ごとに更新する
  const now = useNow(1000);

  const entries = useMemo(() => toQueueEntries(orders.data?.items ?? []), [orders.data]);
  const badges = queueBadgeCount(entries);
  const state = queueState({
    badges,
    capacity: slotsPerSheet(badgeSpec),
    paused,
    printing: sheet.data?.sheet != null,
    secondsLeft: secondsUntilPrint(entries, waitSeconds, now),
  });

  return (
    <section
      className="cb-queue"
      data-action={state.needsAction || undefined}
      aria-label="印刷待ち"
    >
      <h2 className="cb-queue__headline">{state.headline}</h2>
      <p className="cb-queue__detail">{state.detail}</p>
      {orders.error && !orders.data && <Notice tone="error">{orders.error}</Notice>}

      {entries.length > 0 && (
        <ul className="cb-queue__list">
          {entries.map((entry) => {
            // 再印刷は、最初の支払いからの経過になってしまい、再印刷を指示してからの待ち時間とは違うので、出さない
            const waited = waitedSeconds(entry.paidAt, now);
            return (
              <li key={entry.orderId} className="cb-queue__item">
                {entry.thumbnailUrl && (
                  <img src={entry.thumbnailUrl} alt="" className="cb-queue__thumb" />
                )}
                <span className="cb-queue__number">{entry.orderNumberText}</span>
                {entry.badges > 1 && <span className="cb-muted">{entry.badges} 個</span>}
                {/* 再印刷は、色だけでなく、文字でも伝える */}
                {entry.reprint && <span className="cb-queue__tag">再印刷</span>}
                <span className="cb-queue__wait cb-muted">
                  {waited === undefined || entry.reprint ? "" : `${formatSeconds(waited)} 待ち`}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
