import type { SseEvent } from "@canbadge/shared";
import type { Context } from "hono";
import { streamSSE } from "hono/streaming";
import type { Deps } from "../deps";

/** 接続を保つための、空のコメント行を送る間隔。Cloudflare は、100 秒データが流れない接続を切る（それより、十分に短くする） */
export const DEFAULT_SSE_HEARTBEAT_MS = 20_000;
/** 切れたときに、ブラウザ（EventSource）が、つなぎ直すまでの待ち（ms）。つなぎ直すと、画面が全量を取り直す */
const RETRY_HINT_MS = 3000;

/**
 * SSE の購読。accept に合うイベントだけを、event: <type> / data: <JSON> の形で流す。
 * - **ハートビート**：一定の間隔で、空のコメント行（`: ping`）を送る。プロキシ・Cloudflare に、接続を切られないため。
 *   送れなかったとき（相手の端末が、回線ごと消えた）は、その接続を片づける（放っておくと、購読が溜まり続ける）
 * - 接続が切れたら、購読とタイマーを、必ず片づける
 * - 切れたあとは、ブラウザが自動でつなぎ直す。つなぎ直した画面は、REST で最新の状態を取り直す（取りこぼしは、それで直る）
 */
export function subscribeSse(
  c: Context,
  deps: Deps,
  accept: (event: SseEvent) => boolean,
): Response {
  const heartbeatMs = deps.sseHeartbeatMs ?? DEFAULT_SSE_HEARTBEAT_MS;
  return streamSSE(c, async (stream) => {
    let finish: () => void = () => undefined;
    const closed = new Promise<void>((resolve) => {
      finish = resolve;
    });

    const unsubscribe = deps.events.subscribe((event) => {
      if (accept(event)) {
        // 書けなかった（相手が、もういない）接続は、片づける
        stream.writeSSE({ event: event.type, data: JSON.stringify(event) }).catch(() => cleanup());
      }
    });
    const heartbeat = setInterval(() => {
      stream.write(": ping\n\n").catch(() => cleanup());
    }, heartbeatMs);

    /** 購読・タイマーを止めて、待ちを終わらせる。何度呼んでも、1 回だけ働く */
    let cleaned = false;
    const cleanup = () => {
      if (cleaned) return;
      cleaned = true;
      clearInterval(heartbeat);
      unsubscribe();
      finish();
    };
    stream.onAbort(cleanup);

    // 接続できたことと、つなぎ直しの待ちを、最初に知らせる（コメント行・retry 行は、イベントとしては届かない）
    await stream.write(`: connected\nretry: ${RETRY_HINT_MS}\n\n`);
    await closed;
  });
}
