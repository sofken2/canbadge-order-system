import { z } from "zod";
import { idSchema, orderIdSchema } from "./ids";
import { orderStatusSchema, printSheetStatusSchema } from "./status";

// SSE は「変わった」ことを知らせるだけにする。受け取った画面は REST で取り直す（spec.md 10章）。
// 取りこぼしても、再接続したときに全量を取り直せば正しい状態に戻る

export const orderUpdatedEventSchema = z.object({
  type: z.literal("order.updated"),
  orderId: orderIdSchema,
  status: orderStatusSchema,
});

/** 印刷待ちの件数が変わった */
export const queueUpdatedEventSchema = z.object({ type: z.literal("queue.updated") });

export const sheetUpdatedEventSchema = z.object({
  type: z.literal("sheet.updated"),
  sheetId: idSchema,
  status: printSheetStatusSchema,
});

/** 呼び出しモニターの一覧（ready の注文）が変わった。ID は含めない */
export const monitorUpdatedEventSchema = z.object({ type: z.literal("monitor.updated") });

/** 受付状態・価格・一時停止などの設定が変わった */
export const settingsUpdatedEventSchema = z.object({ type: z.literal("settings.updated") });

export const sseEventSchema = z.discriminatedUnion("type", [
  orderUpdatedEventSchema,
  queueUpdatedEventSchema,
  sheetUpdatedEventSchema,
  monitorUpdatedEventSchema,
  settingsUpdatedEventSchema,
]);
export type SseEvent = z.infer<typeof sseEventSchema>;

// 購読の種類ごとに、流してよいイベントを分ける。
// 来場者には自分の注文の変化だけ、モニターには ID を含まないイベントだけを流す
/** GET /api/events/orders/:orderId */
export const orderSseEventSchema = orderUpdatedEventSchema;
/** GET /api/staff/events */
export const staffSseEventSchema = sseEventSchema;
/** GET /api/monitor/events */
export const monitorSseEventSchema = monitorUpdatedEventSchema;
