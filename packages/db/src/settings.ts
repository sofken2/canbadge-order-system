import {
  type Acceptance,
  type Actor,
  type Setting,
  type UpdateSettingRequest,
  updateSettingRequestSchema,
} from "@canbadge/shared";
import { and, eq, ne } from "drizzle-orm";
import { writeAudit } from "./audit";
import type { Database } from "./connection";
import { DbError, validationFailed } from "./errors";
import { applyOrderTransition } from "./orders";
import { getSetting } from "./queries";
import { orders, settings } from "./schema";
import { countStockUsed } from "./stock";
import { type Ctx, write } from "./transaction";

/** busy にしたときに、案内文を指定しなかった場合の文言 */
export const DEFAULT_BUSY_MESSAGE = "混雑のため、注文の受付を一時停止しています。";

/**
 * 設定の初期値。**価格などは仮の値**で、Q01（設定値の確定）で決める。
 * 営業開始の操作をするまでは、受付終了（closed）にしておく
 */
export const defaultSetting: Omit<Setting, "updatedAt"> = {
  businessDate: null,
  acceptance: "closed",
  busyMessage: null,
  price: 200,
  kiraFilmPrice: 100,
  magnetPrice: 100,
  // 在庫の総数は仮の値。Q01（設定値の確定）で、用意した数に直す
  badgeStock: 300,
  kiraShardsStock: 100,
  kiraAuroraStock: 100,
  magnetStock: 100,
  maxQuantityPerOrder: 1,
  maxPendingPerDevice: 2,
  printMaxWaitSeconds: 120,
  printPaused: false,
  orderNumberDigits: 3,
  imageMaxBytes: 10 * 1024 * 1024,
};

/** 設定の行がなければ、初期値で作る（あれば何もしない） */
export function ensureSetting(db: Database): void {
  write(db, ({ tx, at }) => {
    tx.insert(settings)
      .values({ id: 1, ...defaultSetting, updatedAt: at })
      .onConflictDoNothing()
      .run();
  });
}

/** 日本時間での日付（営業日）。サーバーの時刻設定に左右されないよう、+9 時間して UTC として読む */
export function businessDateOf(at: Date): string {
  return new Date(at.getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

/** 条件に合う、支払い待ちの注文を失効させる。注文ごとに遷移関数を通すので、操作ログも残る */
function expireSubmittedOrders(ctx: Ctx, onlyOtherThan?: string): number {
  const condition =
    onlyOtherThan === undefined
      ? eq(orders.status, "submitted")
      : and(eq(orders.status, "submitted"), ne(orders.businessDate, onlyOtherThan));
  const targets = ctx.tx.select({ id: orders.id }).from(orders).where(condition).all();
  for (const { id } of targets) {
    applyOrderTransition(ctx, { orderId: id, to: "expired", actor: "system" });
  }
  return targets.length;
}

function updateSettingRow(ctx: Ctx, patch: Partial<Omit<Setting, "updatedAt">>): Setting {
  ctx.tx
    .update(settings)
    .set({ ...patch, updatedAt: ctx.at })
    .where(eq(settings.id, 1))
    .run();
  return getSetting(ctx.tx);
}

/**
 * 営業開始。営業日を今日（日本時間）にして受付を open にし、
 * 前の営業日に残った支払い待ちの注文を失効させる。注文番号は、新しい営業日の 1 から始まる
 */
export function openBusinessDay(db: Database, input: { actor: Actor }): Setting {
  return write(db, (ctx) => {
    const today = businessDateOf(new Date(ctx.at));
    const before = getSetting(ctx.tx);
    const expired = expireSubmittedOrders(ctx, today);
    const after = updateSettingRow(ctx, {
      businessDate: today,
      acceptance: "open",
      busyMessage: null,
    });
    writeAudit(ctx, {
      actor: input.actor,
      action: "business_day.open",
      targetType: "setting",
      targetId: "1",
      detail: { from: before.businessDate, to: today, expiredOrders: expired },
    });
    return after;
  });
}

/**
 * 受付状態を切り替える。busy は新規注文だけを断り、支払い・印刷・受け渡しは続く。
 * closed にすると、その日の支払い待ちの注文を失効させる
 */
export function setAcceptance(
  db: Database,
  input: { acceptance: Acceptance; busyMessage?: string | null; actor: Actor },
): Setting {
  return write(db, (ctx) => {
    const before = getSetting(ctx.tx);
    const busyMessage =
      input.acceptance === "busy" ? input.busyMessage?.trim() || DEFAULT_BUSY_MESSAGE : null;
    const expired = input.acceptance === "closed" ? expireSubmittedOrders(ctx) : 0;
    const after = updateSettingRow(ctx, { acceptance: input.acceptance, busyMessage });
    writeAudit(ctx, {
      actor: input.actor,
      action: "acceptance.set",
      targetType: "setting",
      targetId: "1",
      detail: { from: before.acceptance, to: input.acceptance, expiredOrders: expired },
    });
    return after;
  });
}

export function setPrintPaused(db: Database, input: { paused: boolean; actor: Actor }): Setting {
  return write(db, (ctx) => {
    const after = updateSettingRow(ctx, { printPaused: input.paused });
    writeAudit(ctx, {
      actor: input.actor,
      action: input.paused ? "print_queue.pause" : "print_queue.resume",
      targetType: "setting",
      targetId: "1",
    });
    return after;
  });
}

/** 緊急印刷の依頼を残す操作名。print-worker が、操作ログからこれを見つけて、待たずに印刷する */
export const PRINT_FLUSH_ACTION = "print_queue.flush";

/**
 * 緊急印刷。印刷待ちのバッジを、用紙が埋まるのも、待ち時間も待たずに、いますぐ印刷する依頼。
 * 依頼は操作ログに残すだけで、印刷は print-worker が次の巡回で行う（別のプロセスなので、DB を通して伝える）。
 * 印刷を止めているときは、止めた意図を勝手に破らないよう、断る
 */
export function requestPrintFlush(db: Database, input: { actor: Actor }): Setting {
  return write(db, (ctx) => {
    const setting = getSetting(ctx.tx);
    if (setting.printPaused) {
      throw new DbError(
        "INVALID_TRANSITION",
        "印刷を止めています。先に印刷を再開してから、緊急印刷をしてください",
      );
    }
    writeAudit(ctx, {
      actor: input.actor,
      action: PRINT_FLUSH_ACTION,
      targetType: "setting",
      targetId: "1",
    });
    return setting;
  });
}

/** 画面で編集する項目（価格・上限など）を、まとめて置き換える */
export function updateSetting(
  db: Database,
  input: { values: UpdateSettingRequest; actor: Actor },
): Setting {
  const parsed = updateSettingRequestSchema.safeParse(input.values);
  if (!parsed.success) throw validationFailed("設定の値が正しくありません", parsed.error.issues);
  return write(db, (ctx) => {
    // 在庫は「残りをこの数にする」指定。総数 = 指定の数 + いま使われている数 に直して保存する
    // （同じトランザクションの中で数えるので、注文と重なっても、残りは指定の数になる）
    const used = countStockUsed(ctx.tx);
    const { badgeStock, kiraShardsStock, kiraAuroraStock, magnetStock, ...rest } = parsed.data;
    const patch: Partial<Omit<Setting, "updatedAt">> = { ...rest };
    if (badgeStock !== undefined) patch.badgeStock = badgeStock + used.badge;
    if (kiraShardsStock !== undefined) patch.kiraShardsStock = kiraShardsStock + used.kiraShards;
    if (kiraAuroraStock !== undefined) patch.kiraAuroraStock = kiraAuroraStock + used.kiraAurora;
    if (magnetStock !== undefined) patch.magnetStock = magnetStock + used.magnet;
    const after = updateSettingRow(ctx, patch);
    writeAudit(ctx, {
      actor: input.actor,
      action: "settings.update",
      targetType: "setting",
      targetId: "1",
      detail: {
        values: patch,
        stockRemainingSetTo: { badgeStock, kiraShardsStock, kiraAuroraStock, magnetStock },
      },
    });
    return after;
  });
}
