import {
  type Actor,
  type OrderItem,
  type OrderItemStatus,
  orderItemStatusLabels,
  orderItemTransitions,
} from "@canbadge/shared";
import { and, eq, sql } from "drizzle-orm";
import { writeAudit } from "./audit";
import type { Database } from "./connection";
import { conflict, DbError } from "./errors";
import { applyOrderTransition } from "./orders";
import { listOrderItems, requireOrder, requireOrderItem } from "./queries";
import { orderItems } from "./schema";
import { type Ctx, write } from "./transaction";
import { findTransition } from "./transition";

type ItemTransitionInput = {
  itemId: string;
  to: OrderItemStatus;
  actor: Actor;
  detail?: Record<string, unknown>;
};

/**
 * 明細（バッジ）の状態を変える（トランザクションの中で呼ぶ版）。
 * - 印刷待ち → 印刷中：注文が支払い済みのときだけ。印刷した回数（printCount）を 1 増やす
 * - 印刷中 → 印刷済み：注文の全明細が印刷済みになったら、注文を「印刷済み」に自動で進める
 */
export function applyItemTransition(ctx: Ctx, input: ItemTransitionInput): OrderItem {
  const item = requireOrderItem(ctx.tx, input.itemId);
  findTransition(orderItemTransitions, orderItemStatusLabels, {
    from: item.status,
    to: input.to,
    actor: input.actor,
  });

  if (input.to === "printing") {
    const order = requireOrder(ctx.tx, item.orderId);
    if (order.status !== "paid") {
      throw new DbError("INVALID_TRANSITION", "支払い済みの注文のバッジだけを印刷できます", {
        orderStatus: order.status,
      });
    }
  }

  const updated = ctx.tx
    .update(orderItems)
    .set({
      status: input.to,
      ...(input.to === "printing" ? { printCount: sql`${orderItems.printCount} + 1` } : {}),
    })
    .where(and(eq(orderItems.id, item.id), eq(orderItems.status, item.status)))
    .returning({ id: orderItems.id })
    .all();
  if (updated.length === 0) throw conflict("バッジ");

  writeAudit(ctx, {
    actor: input.actor,
    action: "order_item.transition",
    targetType: "order_item",
    targetId: item.id,
    detail: { from: item.status, to: input.to, orderId: item.orderId, ...input.detail },
  });

  if (input.to === "printed") advanceOrderIfAllPrinted(ctx, item.orderId);
  return requireOrderItem(ctx.tx, item.id);
}

/** 注文が支払い済みで、全明細が印刷済みなら、注文を印刷済みに進める（呼ぶ側が意識しなくて済むように） */
function advanceOrderIfAllPrinted(ctx: Ctx, orderId: string): void {
  const order = requireOrder(ctx.tx, orderId);
  if (order.status !== "paid") return;
  const items = listOrderItems(ctx.tx, orderId);
  if (items.every((item) => item.status === "printed")) {
    applyOrderTransition(ctx, { orderId, to: "printed", actor: "system" });
  }
}

/** 明細の状態を変える。印刷中にする・印刷済みにする・印刷待ちに戻すは、これを通す */
export function transitionOrderItem(db: Database, input: ItemTransitionInput): OrderItem {
  return write(db, (ctx) => applyItemTransition(ctx, input));
}
