import { cpSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { databasePath, getOrder, listOrderItems, openDatabase } from "@canbadge/db";
import { type SeedSummary, seedSampleData } from "@canbadge/fixtures";
import type { Hono } from "hono";
import { createApp } from "./app";
import { createEventHub } from "./events";

const NOW = new Date("2026-11-03T12:00:00+09:00");

/** サンプルデータは 1 回だけ作り、テストごとにフォルダごと複製して使う（毎回作ると遅いため） */
let template: { dir: string; summary: SeedSummary } | undefined;

function getTemplate() {
  if (!template) {
    const dir = mkdtempSync(join(tmpdir(), "canbadge-api-template-"));
    template = { dir, summary: seedSampleData({ dataDir: dir, now: NOW }) };
  }
  return template;
}

export type TestApp = ReturnType<typeof createTestApp>;

/** サンプルデータの入った DB と、それを使う API を作る。終わったら close を呼ぶ */
export function createTestApp(options: { allowPublicStaff?: boolean } = {}) {
  const source = getTemplate();
  const dir = mkdtempSync(join(tmpdir(), "canbadge-api-"));
  cpSync(source.dir, dir, { recursive: true });

  const db = openDatabase({ path: databasePath(dir), migrate: false });
  const events = createEventHub(db, { intervalMs: 0 });
  const app: Hono = createApp({
    db,
    dataDir: dir,
    events,
    allowPublicStaff: options.allowPublicStaff ?? false,
  });

  const orderId = (name: string): string => {
    const found = source.summary.orders[name]?.orderId;
    if (!found) throw new Error(`サンプルの注文がありません: ${name}`);
    return found;
  };

  return {
    app,
    db,
    dir,
    events,
    summary: source.summary,
    orderId,
    /** サンプルの注文の、確認コード（スタッフ向けの API は返さないので、DB から読む） */
    confirmationCode: (name: string): string =>
      getOrder(db.orm, orderId(name))?.confirmationCode ?? "",
    anonToken: (name: string): string => getOrder(db.orm, orderId(name))?.anonToken ?? "",
    itemId: (name: string): string => listOrderItems(db.orm, orderId(name))[0]?.id ?? "",
    close: async () => {
      events.stop();
      db.close();
      // Windows では、閉じた直後はファイルが解放されていないことがあるので、GC しながら再試行する
      for (let attempt = 0; attempt < 10; attempt++) {
        try {
          rmSync(dir, { recursive: true, force: true });
          return;
        } catch {
          Bun.gc(true);
          await Bun.sleep(50);
        }
      }
    },
  };
}

type RequestOptions = {
  json?: unknown;
  form?: FormData;
  headers?: Record<string, string>;
};

/** app にリクエストを送る。json を渡せば JSON の本体で送る */
export async function call(
  app: Hono,
  method: string,
  path: string,
  options: RequestOptions = {},
): Promise<Response> {
  const headers: Record<string, string> = { ...options.headers };
  let body: string | FormData | undefined;
  if (options.json !== undefined) {
    headers["content-type"] = "application/json";
    body = JSON.stringify(options.json);
  } else if (options.form) {
    body = options.form;
  }
  return await app.request(path, { method, headers, ...(body === undefined ? {} : { body }) });
}

/** SSE の接続を開き、最初の「接続できた」の知らせを受けたあとの、続きを読むための口を返す */
export async function openSse(app: Hono, path: string, headers: Record<string, string> = {}) {
  const response = await call(app, "GET", path, { headers });
  const reader = response.body?.getReader();
  if (!reader) throw new Error("SSE の応答に本体がありません");
  const decoder = new TextDecoder();
  let received = "";

  const readMore = async (until: (text: string) => boolean, timeoutMs = 2000): Promise<string> => {
    const deadline = Date.now() + timeoutMs;
    while (!until(received) && Date.now() < deadline) {
      const chunk = await Promise.race([
        reader.read(),
        new Promise<undefined>((resolve) => setTimeout(() => resolve(undefined), 100)),
      ]);
      if (chunk?.done) break;
      if (chunk?.value) received += decoder.decode(chunk.value, { stream: true });
    }
    return received;
  };

  await readMore((text) => text.includes(": connected"));
  return {
    response,
    readMore,
    received: () => received,
    close: () => reader.cancel().catch(() => undefined),
  };
}
