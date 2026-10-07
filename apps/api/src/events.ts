import { type Database, listAuditLogsSince } from "@canbadge/db";
import {
  type AuditLog,
  orderStatusSchema,
  printSheetStatusSchema,
  type SseEvent,
  sseEventSchema,
} from "@canbadge/shared";
import type { EventHub } from "./deps";

/**
 * 操作ログ 1 行から、SSE イベントを作る。SSE は「変わった」ことだけを知らせ、
 * 受け取った画面が REST で取り直す。api 自身の操作も、print-worker の操作も、
 * 同じ操作ログを通るので、イベントを作る場所はここ 1 か所になる
 */
export function eventsFromAudit(log: AuditLog): SseEvent[] {
  const detail = log.detail ?? {};
  const candidates: unknown[] = [];

  switch (log.action) {
    case "order.create":
      candidates.push({ type: "order.updated", orderId: log.targetId, status: "submitted" });
      break;
    case "order.transition": {
      const to = orderStatusSchema.safeParse(detail.to);
      const from = orderStatusSchema.safeParse(detail.from);
      if (to.success)
        candidates.push({ type: "order.updated", orderId: log.targetId, status: to.data });
      // 印刷待ちの件数が変わる遷移（支払い・印刷済み・再印刷・返金など）
      if (to.data === "paid" || from.data === "paid") candidates.push({ type: "queue.updated" });
      // 呼び出しモニターの一覧が変わる遷移（完成・受け渡し・再印刷・返金など）
      if (to.data === "ready" || from.data === "ready")
        candidates.push({ type: "monitor.updated" });
      break;
    }
    case "order_item.transition":
    case "reprint":
      candidates.push({ type: "queue.updated" });
      break;
    case "print_sheet.create":
      candidates.push({ type: "sheet.updated", sheetId: log.targetId, status: "printing" });
      candidates.push({ type: "queue.updated" });
      break;
    case "print_sheet.transition": {
      const to = printSheetStatusSchema.safeParse(detail.to);
      if (to.success)
        candidates.push({ type: "sheet.updated", sheetId: log.targetId, status: to.data });
      candidates.push({ type: "queue.updated" });
      break;
    }
    case "business_day.open":
    case "acceptance.set":
    case "print_queue.pause":
    case "print_queue.resume":
    case "settings.update":
      candidates.push({ type: "settings.updated" });
      break;
    default:
      break;
  }

  // 契約に合うものだけを流す
  return candidates.flatMap((candidate) => {
    const parsed = sseEventSchema.safeParse(candidate);
    return parsed.success ? [parsed.data] : [];
  });
}

/**
 * 操作ログを数秒ごとに読み、前回より後の行から作ったイベントを、購読者に配る。
 * 起動したあとに増えた行だけを扱う（過去の履歴は配らない）。
 * intervalMs が 0 なら、定期実行しない（テストでは poll を手で呼ぶ）
 */
export function createEventHub(db: Database, options: { intervalMs: number }): EventHub {
  const listeners = new Set<(event: SseEvent) => void>();
  const latest = db.sqlite.query("SELECT COALESCE(MAX(seq), 0) AS seq FROM audit_logs").get() as {
    seq: number;
  };
  let lastSeq = latest.seq;

  const poll = () => {
    // 定期実行の中で、例外を外に出さない。print-worker が書き込み中で、DB が一瞬使えないときなどに、
    // api プロセス全体が落ちるのを防ぐ（次の巡回で、続きから読む）
    try {
      const rows = listAuditLogsSince(db, lastSeq, 500);
      for (const { seq, log } of rows) {
        lastSeq = seq;
        for (const event of eventsFromAudit(log)) {
          for (const listener of listeners) {
            try {
              listener(event);
            } catch (error) {
              // 1 つの接続の失敗で、ほかの接続への配信を止めない
              console.error("api: SSE の配信に失敗しました", error);
            }
          }
        }
      }
    } catch (error) {
      console.error("api: 操作ログを読めませんでした（次の巡回で、もう一度）", error);
    }
  };

  const timer = options.intervalMs > 0 ? setInterval(poll, options.intervalMs) : undefined;

  return {
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    poll,
    listenerCount: () => listeners.size,
    stop: () => {
      if (timer) clearInterval(timer);
      listeners.clear();
    },
  };
}
