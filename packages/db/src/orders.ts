import {
  type Actor,
  anonTokenSchema,
  type Design,
  type EditorData,
  editorDataSchema,
  kiraPatternLabels,
  kiraPatternSchema,
  type Order,
  type OrderItem,
  type OrderStatus,
  orderStatusLabels,
  orderTransitions,
  quantitySchema,
  relativePathSchema,
} from "@canbadge/shared";
import { and, count, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { writeAudit } from "./audit";
import type { Database, Reader } from "./connection";
import { conflict, DbError, notFound, validationFailed } from "./errors";
import { generateConfirmationCode } from "./generate";
import { getSetting, listOrderItems, requireOrder } from "./queries";
import { toDesign, toOrder, toOrderItem } from "./rows";
import { archiveEntries, designs, orderItems, orders } from "./schema";
import { getStockRemaining } from "./stock";
import { type Ctx, idAt, write } from "./transaction";
import { findTransition } from "./transition";

const createOrderInputSchema = z.object({
  /** 保存済みの画像（データ置き場の images/ 以下の相対パス）。アップロードの処理は api の担当 */
  imagePath: relativePathSchema,
  editorData: editorDataSchema,
  quantity: quantitySchema,
  /** キラフィルムを貼る個数（0〜quantity）。省略すると 0 */
  kiraQuantity: z.int().nonnegative().default(0),
  /** キラフィルムの柄。kiraQuantity が 1 以上のとき必須（0 のときは、あっても記録しない） */
  kiraPattern: kiraPatternSchema.optional(),
  /** マグネット加工をする個数（0〜quantity）。キラフィルムとは独立。省略すると 0 */
  magnetQuantity: z.int().nonnegative().default(0),
  anonToken: anonTokenSchema,
  sourceArchiveEntryId: z.string().optional(),
});
export type CreateOrderInput = z.input<typeof createOrderInputSchema>;

/** 匿名トークンの持ち主が、いま持っている支払い待ち（submitted）の注文の数 */
export function countPendingOrders(reader: Reader, anonToken: string): number {
  const row = reader
    .select({ n: count() })
    .from(orders)
    .where(and(eq(orders.anonToken, anonToken), eq(orders.status, "submitted")))
    .get();
  return row?.n ?? 0;
}

export type CreatedOrder = { order: Order; items: OrderItem[]; design: Design };

/**
 * 注文を作る。受付が open でなければ断る（受付状態の切り替えと入れ違いにならないよう、
 * 同じトランザクションの中で確かめる）。注文番号は、その営業日の最大値 + 1 を、同じトランザクションで採番する。
 * 書き込みロックを先に取るので、api と print-worker が同時に動いても番号は重複しない
 * （営業日と番号の組には、DB の一意制約もある）
 */
export function createOrder(db: Database, input: CreateOrderInput): CreatedOrder {
  const parsed = createOrderInputSchema.safeParse(input);
  if (!parsed.success) throw validationFailed("注文の内容が正しくありません", parsed.error.issues);
  const data = parsed.data;

  return write(db, (ctx) => {
    const setting = getSetting(ctx.tx);
    if (setting.acceptance !== "open" || setting.businessDate === null) {
      throw new DbError("NOT_ACCEPTING", setting.busyMessage ?? "現在、注文を受け付けていません", {
        acceptance: setting.acceptance,
        busyMessage: setting.busyMessage,
      });
    }
    if (data.quantity > setting.maxQuantityPerOrder) {
      throw validationFailed(`1 回の注文は ${setting.maxQuantityPerOrder} 個までです`);
    }
    if (data.kiraQuantity > data.quantity) {
      throw validationFailed("キラフィルムの個数が、注文の個数を超えています");
    }
    if (data.kiraQuantity > 0 && !data.kiraPattern) {
      throw validationFailed("キラフィルムの柄を選んでください");
    }
    if (data.magnetQuantity > data.quantity) {
      throw validationFailed("マグネット加工の個数が、注文の個数を超えています");
    }

    // 在庫。数えるのも、注文を作るのも、同じトランザクションなので、同時に出されても、超えて売らない
    const remaining = getStockRemaining(ctx.tx, setting);
    if (data.quantity > remaining.badge) {
      throw new DbError("CONFLICT", `バッジの在庫が足りません（残り ${remaining.badge} 個）`);
    }
    if (data.kiraQuantity > 0 && data.kiraPattern) {
      const left = data.kiraPattern === "shards" ? remaining.kiraShards : remaining.kiraAurora;
      if (data.kiraQuantity > left) {
        throw new DbError(
          "CONFLICT",
          `キラフィルム（${kiraPatternLabels[data.kiraPattern]}）の在庫が足りません（残り ${left} 個）`,
        );
      }
    }
    if (data.magnetQuantity > remaining.magnet) {
      throw new DbError("CONFLICT", `マグネットの在庫が足りません（残り ${remaining.magnet} 個）`);
    }

    // 1 端末（匿名トークン）あたりの、支払い待ちの注文の上限。同じトランザクションで数えるので、
    // 同時に何件も出されても、上限を超えない
    const pending = countPendingOrders(ctx.tx, data.anonToken);
    if (pending >= setting.maxPendingPerDevice) {
      throw new DbError(
        "RATE_LIMITED",
        `支払い待ちの注文が ${setting.maxPendingPerDevice} 件あります。レジで支払うか、取り消してから、注文してください`,
        { pending, limit: setting.maxPendingPerDevice },
      );
    }

    // 作品からのコピーは、元作品が公開中のときだけ作れる。非公開にされたあとに、入れ違いで作られないよう、
    // 非公開にする処理（支払い前のコピーを止める）と同じように、トランザクションの中で確かめる
    if (data.sourceArchiveEntryId) {
      const source = ctx.tx
        .select({ status: archiveEntries.status })
        .from(archiveEntries)
        .where(eq(archiveEntries.id, data.sourceArchiveEntryId))
        .get();
      if (source?.status !== "public") throw notFound("作品");
    }

    const designId = idAt(ctx);
    const orderId = idAt(ctx);
    const itemId = idAt(ctx);

    const last = ctx.tx
      .select({ max: sql<number | null>`max(${orders.orderNumber})` })
      .from(orders)
      .where(eq(orders.businessDate, setting.businessDate))
      .get();
    const orderNumber = (last?.max ?? 0) + 1;

    const designRow = ctx.tx
      .insert(designs)
      .values({
        id: designId,
        imagePath: data.imagePath,
        editorData: data.editorData as EditorData,
        sourceArchiveEntryId: data.sourceArchiveEntryId ?? null,
        createdAt: ctx.at,
      })
      .returning()
      .get();
    const orderRow = ctx.tx
      .insert(orders)
      .values({
        id: orderId,
        businessDate: setting.businessDate,
        orderNumber,
        confirmationCode: generateConfirmationCode(),
        anonToken: data.anonToken,
        status: "submitted",
        totalAmount:
          setting.price * data.quantity +
          setting.kiraFilmPrice * data.kiraQuantity +
          setting.magnetPrice * data.magnetQuantity,
        createdAt: ctx.at,
      })
      .returning()
      .get();
    // 印刷待ち（queued）で作る。注文が支払い済みになるまでは、印刷の対象にならない
    const itemRow = ctx.tx
      .insert(orderItems)
      .values({
        id: itemId,
        orderId,
        designId,
        quantity: data.quantity,
        kiraQuantity: data.kiraQuantity,
        kiraPattern: data.kiraQuantity > 0 ? (data.kiraPattern ?? null) : null,
        magnetQuantity: data.magnetQuantity,
        status: "queued",
        printCount: 0,
      })
      .returning()
      .get();

    writeAudit(ctx, {
      actor: "visitor",
      action: "order.create",
      targetType: "order",
      targetId: orderId,
      detail: { businessDate: setting.businessDate, orderNumber },
    });
    return { order: toOrder(orderRow), items: [toOrderItem(itemRow)], design: toDesign(designRow) };
  });
}

type OrderTransitionInput = {
  orderId: string;
  to: OrderStatus;
  actor: Actor;
  /** 操作ログの detail に足す内容 */
  detail?: Record<string, unknown>;
};

/** 状態に応じて更新する日時の列。再印刷で支払い済みに戻るときは、完成の時刻を消す */
function timestampPatch(from: OrderStatus, to: OrderStatus, at: string) {
  switch (to) {
    case "paid":
      return from === "submitted" ? { paidAt: at } : { readyAt: null };
    case "ready":
      return { readyAt: at };
    case "picked_up":
      return { pickedUpAt: at };
    case "refunded":
      return { refundedAt: at };
    default:
      return {};
  }
}

/**
 * 注文の状態を変える（トランザクションの中で呼ぶ版）。ほかの遷移関数（明細・再印刷）からも使う。
 * 表にない遷移・できない役割は断る。更新は「現在の状態」を条件に含め、更新できなければ競合として扱う
 */
export function applyOrderTransition(ctx: Ctx, input: OrderTransitionInput): Order {
  const order = requireOrder(ctx.tx, input.orderId);
  findTransition(orderTransitions, orderStatusLabels, {
    from: order.status,
    to: input.to,
    actor: input.actor,
  });

  // 印刷待ちから組み立て中への遷移は、全明細が印刷済みのときだけ（明細の遷移が自動で行う）
  if (order.status === "paid" && input.to === "assembling") {
    const items = listOrderItems(ctx.tx, order.id);
    if (items.length === 0 || items.some((item) => item.status !== "printed")) {
      throw new DbError("INVALID_TRANSITION", "印刷が済んでいない明細があります");
    }
  }

  // 更新できた行がなければ、読んだあとに別の操作で状態が変わった（競合）
  const updated = ctx.tx
    .update(orders)
    .set({ status: input.to, ...timestampPatch(order.status, input.to, ctx.at) })
    .where(and(eq(orders.id, order.id), eq(orders.status, order.status)))
    .returning({ id: orders.id })
    .all();
  if (updated.length === 0) throw conflict("注文");

  writeAudit(ctx, {
    actor: input.actor,
    action: "order.transition",
    targetType: "order",
    targetId: order.id,
    detail: { from: order.status, to: input.to, ...input.detail },
  });
  return requireOrder(ctx.tx, order.id);
}

/**
 * 受け渡し。確認コードを照合してから、完成 → 受け渡し済みに変える（同じトランザクションの中で）。
 * 画面に正解の確認コードを持たせないため、照合は db で行う。違えば CONFIRMATION_MISMATCH
 */
export function pickupOrder(
  db: Database,
  input: { orderId: string; confirmationCode: string; actor: Actor },
): Order {
  return write(db, (ctx) => {
    const order = requireOrder(ctx.tx, input.orderId);
    if (order.confirmationCode !== input.confirmationCode) {
      throw new DbError("CONFIRMATION_MISMATCH", "確認コードが違います");
    }
    return applyOrderTransition(ctx, { orderId: order.id, to: "picked_up", actor: input.actor });
  });
}

/**
 * 強制の受け渡し。お客さんが確認コードを見られないとき（キャッシュを消した・端末を替えたなど）に、
 * スタッフが確認コードなしで、完成 → 受け渡し済みにする。遷移は通常の受け渡しと同じ（完成の注文だけ）。
 * あとで確かめられるよう、操作ログの detail に forced を残す
 */
export function forcePickupOrder(db: Database, input: { orderId: string; actor: Actor }): Order {
  return transitionOrder(db, {
    orderId: input.orderId,
    to: "picked_up",
    actor: input.actor,
    detail: { forced: true },
  });
}

/** 注文の状態を変える。支払い・組み立て・完成・返金・取り消しは、これを通す（受け渡しは pickupOrder） */
export function transitionOrder(db: Database, input: OrderTransitionInput): Order {
  return write(db, (ctx) => applyOrderTransition(ctx, input));
}
