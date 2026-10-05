import type { SseEvent } from "@canbadge/shared";
import type { Context } from "hono";
import { streamSSE } from "hono/streaming";
import type { Deps } from "../deps";

/**
 * SSE の購読。accept に合うイベントだけを、event: <type> / data: <JSON> の形で流す。
 * 接続が切れたら購読をやめる。接続維持のための定期的な送信（ハートビート）と、
 * 再接続時の取り直しの作法は、A03（SSE 本番化）で入れる
 */
export function subscribeSse(
  c: Context,
  deps: Deps,
  accept: (event: SseEvent) => boolean,
): Response {
  return streamSSE(c, async (stream) => {
    const unsubscribe = deps.events.subscribe((event) => {
      if (accept(event)) {
        void stream.writeSSE({ event: event.type, data: JSON.stringify(event) });
      }
    });
    const closed = new Promise<void>((resolve) =>
      stream.onAbort(() => {
        unsubscribe();
        resolve();
      }),
    );
    // 接続できたことを、最初に 1 回知らせる（コメント行なので、イベントとしては届かない）
    await stream.write(": connected\n\n");
    await closed;
  });
}
