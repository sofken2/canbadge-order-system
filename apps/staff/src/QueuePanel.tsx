import { badgeSpec, slotsPerSheet } from "@canbadge/badge-spec";
import { Button, ConfirmDialog, Notice, useAction, useResource } from "@canbadge/ui";
import { useMemo, useState } from "react";
import { api } from "./api";
import {
  formatSeconds,
  queueBadgeCount,
  queueState,
  secondsUntilEntry,
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

  // 緊急印刷：用紙が埋まるのも、待ち時間も待たずに、いまの印刷待ちを全部印刷する（用紙は余る）
  const [asking, setAsking] = useState(false);
  const [requested, setRequested] = useState(false);
  const flush = useAction(async () => {
    await api.call("flushPrintQueue");
    setAsking(false);
    setRequested(true);
  });

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

      {badges > 0 && !paused && (
        <Button variant="line" block onClick={() => setAsking(true)}>
          緊急印刷（待たずに、いま印刷する）
        </Button>
      )}
      {requested && (
        <Notice tone="info">緊急印刷を依頼しました。数秒のうちに、印刷が始まります。</Notice>
      )}
      <ConfirmDialog
        open={asking}
        title="緊急印刷をします"
        confirmLabel="いま印刷する"
        running={flush.running}
        error={flush.error}
        onConfirm={() => void flush.run()}
        onCancel={() => setAsking(false)}
      >
        <p>
          印刷待ちの {badges}{" "}
          個のバッジを、用紙が埋まるのも、待ち時間も待たずに、いますぐ印刷します。
          用紙に空きができるので、急ぎのときだけ使ってください。
        </p>
      </ConfirmDialog>

      {entries.length > 0 && (
        <ul className="cb-queue__list">
          {entries.map((entry) => {
            // 再印刷は、最初の支払いからの経過ではなく、印刷まで残りの秒数を出す（再印刷を指示してから、待ち時間の半分）
            const waited = waitedSeconds(entry.paidAt, now);
            const left = entry.reprint ? secondsUntilEntry(entry, waitSeconds, now) : undefined;
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
                  {entry.reprint
                    ? left === undefined
                      ? ""
                      : left === 0
                        ? "まもなく印刷"
                        : `あと ${formatSeconds(left)}`
                    : waited === undefined
                      ? ""
                      : `${formatSeconds(waited)} 待ち`}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
