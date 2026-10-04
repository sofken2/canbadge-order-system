import { z } from "zod";
import { orderNumberSchema } from "../ids";
import { isoDateTimeSchema } from "../primitives";

/**
 * GET /api/monitor/ready。呼び出しモニターに出す、ready の注文。
 * 注文 ID は QR の中身そのものなので、画面に出る番号だけを返し、ID は含めない
 */
export const monitorReadyItemSchema = z.object({
  orderNumber: orderNumberSchema,
  orderNumberText: z.string(),
  readyAt: isoDateTimeSchema,
});
export type MonitorReadyItem = z.infer<typeof monitorReadyItemSchema>;

export const monitorReadyResponseSchema = z.object({ items: z.array(monitorReadyItemSchema) });
export type MonitorReadyResponse = z.infer<typeof monitorReadyResponseSchema>;
