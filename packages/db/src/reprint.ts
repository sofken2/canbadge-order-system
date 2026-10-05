import type { Actor, OrderStatus } from "@canbadge/shared";
import { writeAudit } from "./audit";
import type { Database } from "./connection";
import { DbError, validationFailed } from "./errors";
import { applyItemTransition } from "./items";
import { applyOrderTransition } from "./orders";
import { requireOrder, requireOrderItem } from "./queries";
import { write } from "./transaction";

/** 履歴から再印刷できる注文の状態。受け渡し済み・取り消し・失効・返金済みは、もう作り直さない */
const reprintableOrderStatuses: readonly OrderStatus[] = ["paid", "printed", "assembling", "ready"];

/** 再印刷で、注文を印刷待ちに戻す状態。paid は、すでに印刷待ちなので変えない */
const resetToPaidStatuses: readonly OrderStatus[] = ["printed", "assembling", "ready"];

export type ReprintResult = { reprintedItemIds: string[]; skippedItemIds: string[] };

/**
 * 履歴から選んだバッジを再印刷に回す（組み立て中に傷が見つかった場合など）。
 * すべて 1 つのトランザクションで行い、1 つでも再印刷できなければ全体を取り消す。
 * - 印刷済みのバッジ：印刷待ちに戻る。printCount が 1 以上なので、次のシートの先頭に優先して載る
 * - その注文が印刷済み・組み立て中・完成なら、注文を印刷待ち（paid）に戻す。
 *   完成から戻る場合は、完成の時刻が消え、呼び出しモニターの表示からも消える
 * - すでに印刷待ちのバッジは、何もせず skipped に入れる
 * - 印刷中のバッジ（確認前のシート）と、受け渡し済みなどの注文のバッジは断る
 */
export function reprintItems(
  db: Database,
  input: { orderItemIds: string[]; actor: Actor },
): ReprintResult {
  const ids = [...new Set(input.orderItemIds)];
  if (ids.length === 0) throw validationFailed("再印刷するバッジを選んでください");

  return write(db, (ctx) => {
    const reprinted: string[] = [];
    const skipped: string[] = [];

    for (const itemId of ids) {
      const item = requireOrderItem(ctx.tx, itemId);
      if (item.status === "queued") {
        skipped.push(itemId);
        continue;
      }
      if (item.status === "printing") {
        throw new DbError(
          "INVALID_TRANSITION",
          "印刷中のバッジです。印刷の確認で、再印刷を選んでください",
          { orderItemId: itemId },
        );
      }
      const order = requireOrder(ctx.tx, item.orderId);
      if (!reprintableOrderStatuses.includes(order.status)) {
        throw new DbError("INVALID_TRANSITION", "この注文のバッジは、再印刷できません", {
          orderItemId: itemId,
          orderStatus: order.status,
        });
      }

      applyItemTransition(ctx, {
        itemId,
        to: "queued",
        actor: input.actor,
        detail: { reason: "reprint" },
      });
      if (resetToPaidStatuses.includes(order.status)) {
        applyOrderTransition(ctx, {
          orderId: order.id,
          to: "paid",
          actor: input.actor,
          detail: { reason: "reprint" },
        });
      }
      writeAudit(ctx, {
        actor: input.actor,
        action: "reprint",
        targetType: "order_item",
        targetId: itemId,
        detail: { orderId: order.id, previousOrderStatus: order.status },
      });
      reprinted.push(itemId);
    }
    return { reprintedItemIds: reprinted, skippedItemIds: skipped };
  });
}
