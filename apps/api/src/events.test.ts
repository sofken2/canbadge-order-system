import { describe, expect, test } from "bun:test";
import type { AuditLog } from "@canbadge/shared";
import { eventsFromAudit } from "./events";

const ID = "01HZX3V5Q8N4M6T2B9C7D1E0FA";

function log(partial: Pick<AuditLog, "action" | "targetType"> & Partial<AuditLog>): AuditLog {
  return {
    id: "01HZX3V5Q8N4M6T2B9C7D1E0FB",
    actor: "staff",
    at: "2026-11-03T00:00:00.000Z",
    targetId: ID,
    ...partial,
  };
}

const types = (events: ReturnType<typeof eventsFromAudit>) => events.map((e) => e.type);

describe("操作ログから SSE イベントへ", () => {
  test("注文の作成は、支払い待ちの注文の変化", () => {
    expect(eventsFromAudit(log({ action: "order.create", targetType: "order" }))).toEqual([
      { type: "order.updated", orderId: ID, status: "submitted" },
    ]);
  });

  test("支払いは、注文の変化と、印刷待ちの件数の変化", () => {
    const events = eventsFromAudit(
      log({
        action: "order.transition",
        targetType: "order",
        detail: { from: "submitted", to: "paid" },
      }),
    );
    expect(events).toEqual([
      { type: "order.updated", orderId: ID, status: "paid" },
      { type: "queue.updated" },
    ]);
  });

  test("完成と、完成からの遷移（受け渡し・再印刷）は、呼び出しモニターの変化も伴う", () => {
    const toReady = eventsFromAudit(
      log({
        action: "order.transition",
        targetType: "order",
        detail: { from: "assembling", to: "ready" },
      }),
    );
    expect(types(toReady)).toEqual(["order.updated", "monitor.updated"]);
    const fromReady = eventsFromAudit(
      log({
        action: "order.transition",
        targetType: "order",
        detail: { from: "ready", to: "picked_up" },
      }),
    );
    expect(types(fromReady)).toEqual(["order.updated", "monitor.updated"]);
    // 再印刷で完成から印刷待ちに戻るときは、印刷待ちの件数も変わる
    const reprint = eventsFromAudit(
      log({
        action: "order.transition",
        targetType: "order",
        detail: { from: "ready", to: "paid" },
      }),
    );
    expect(types(reprint)).toEqual(["order.updated", "queue.updated", "monitor.updated"]);
  });

  test("印刷シートは、シートの変化と印刷待ちの変化", () => {
    expect(
      eventsFromAudit(log({ action: "print_sheet.create", targetType: "print_sheet" })),
    ).toEqual([
      { type: "sheet.updated", sheetId: ID, status: "printing" },
      { type: "queue.updated" },
    ]);
    expect(
      eventsFromAudit(
        log({
          action: "print_sheet.transition",
          targetType: "print_sheet",
          detail: { from: "printing", to: "confirmed" },
        }),
      ),
    ).toEqual([
      { type: "sheet.updated", sheetId: ID, status: "confirmed" },
      { type: "queue.updated" },
    ]);
  });

  test("明細の遷移と再印刷は、印刷待ちの変化", () => {
    expect(
      eventsFromAudit(log({ action: "order_item.transition", targetType: "order_item" })),
    ).toEqual([{ type: "queue.updated" }]);
    expect(eventsFromAudit(log({ action: "reprint", targetType: "order_item" }))).toEqual([
      { type: "queue.updated" },
    ]);
  });

  test("設定の変化（営業開始・受付状態・一時停止・更新）", () => {
    for (const action of [
      "business_day.open",
      "acceptance.set",
      "print_queue.pause",
      "print_queue.resume",
      "settings.update",
    ]) {
      expect(eventsFromAudit(log({ action, targetType: "setting" }))).toEqual([
        { type: "settings.updated" },
      ]);
    }
  });

  test("知らない操作と、契約に合わない詳細は、イベントにしない", () => {
    expect(eventsFromAudit(log({ action: "fixtures.seed", targetType: "setting" }))).toEqual([]);
    expect(
      eventsFromAudit(
        log({ action: "order.transition", targetType: "order", detail: { to: "unknown" } }),
      ),
    ).toEqual([]);
  });
});
