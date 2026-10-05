import { Hono } from "hono";
import type { Deps } from "./deps";
import { toApiError } from "./errors";
import { handlers } from "./handlers";
import { registerRoutes } from "./register";

/**
 * API のアプリ。依存（DB・データ置き場・SSE の配信口）は外から渡す（テストで差し替えるため）。
 * 契約（packages/shared の endpoints）の全エンドポイントを登録し、
 * 失敗は、契約の形（{ error: { code, message } }）で返す
 */
export function createApp(deps: Deps): Hono {
  const app = new Hono();

  // 画面と Caddy が疎通を確かめるための口。業務のエンドポイントではなく、契約には含めない
  app.get("/api/health", (c) => c.json({ status: "ok" }));

  registerRoutes(app, handlers, deps);

  app.notFound((c) =>
    c.json({ error: { code: "NOT_FOUND" as const, message: "このアドレスは存在しません" } }, 404),
  );
  app.onError((error, c) => {
    const { status, body } = toApiError(error);
    return c.json(body, status as 400);
  });
  return app;
}
