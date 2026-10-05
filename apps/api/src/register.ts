import { type Endpoint, type EndpointName, endpoints } from "@canbadge/shared";
import type { Context, Hono } from "hono";
import type { z } from "zod";
import type { Deps } from "./deps";
import { ApiException, validationFailed } from "./errors";
import { assertNotPublic } from "./guard";

type EndpointOf<N extends EndpointName> = (typeof endpoints)[N];

/** エンドポイントの params・query・body の、検証したあとの型（なければ undefined） */
type Parsed<E, K extends "params" | "query" | "body"> =
  E extends Record<K, infer S> ? (S extends z.ZodType ? z.output<S> : undefined) : undefined;

/** ハンドラーが返すもの。JSON のエンドポイントは契約の応答の形、それ以外（画像・PDF・SSE など）は Response */
type Output<E> = E extends { response: infer R }
  ? R extends z.ZodType
    ? z.input<R>
    : Response
  : Response;

export type HandlerArgs<N extends EndpointName> = {
  c: Context;
  deps: Deps;
  params: Parsed<EndpointOf<N>, "params">;
  query: Parsed<EndpointOf<N>, "query">;
  body: Parsed<EndpointOf<N>, "body">;
};

export type Handler<N extends EndpointName> = (
  args: HandlerArgs<N>,
) => Output<EndpointOf<N>> | Promise<Output<EndpointOf<N>>>;

/** 全エンドポイントのハンドラー。契約に 1 つ足りなくても、型のエラーになる */
export type Handlers = { [N in EndpointName]: Handler<N> };
export type HandlersFor<K extends EndpointName> = { [N in K]: Handler<N> };

/** リクエストの本体を JSON として読む。空なら {}（本体のない POST でも受け付ける） */
async function readJson(c: Context): Promise<unknown> {
  const text = await c.req.text();
  if (text.trim() === "") return {};
  try {
    return JSON.parse(text);
  } catch {
    throw validationFailed("リクエストの本体が JSON ではありません");
  }
}

/**
 * 契約の一覧（endpoints）から、すべてのルートを登録する。
 * 入力（params・query・body）と、JSON の応答を、契約のスキーマで検証する。
 * 応答の検証は、契約にないフィールド（匿名トークンなど）が漏れるのを防ぐ役目も持つ
 */
export function registerRoutes(app: Hono, handlers: Handlers, deps: Deps): void {
  for (const [name, endpoint] of Object.entries(endpoints) as [EndpointName, Endpoint][]) {
    app.on(endpoint.method, endpoint.path, async (c) => {
      if (endpoint.access !== "visitor") assertNotPublic(c, deps);

      const input = {
        c,
        deps,
        params: endpoint.params ? endpoint.params.parse(c.req.param()) : undefined,
        query: endpoint.query ? endpoint.query.parse(c.req.query()) : undefined,
        body: endpoint.body ? endpoint.body.parse(await readJson(c)) : undefined,
      };
      const handler = handlers[name] as (args: typeof input) => unknown;
      const result = await handler(input);

      if (endpoint.response === null) return result as Response;

      const checked = endpoint.response.safeParse(result);
      if (!checked.success) {
        // 契約と実装のずれ。画面には詳細を見せず、開発者がログで気づけるようにする
        console.error(`api: ${name} の応答が契約に合いません`, checked.error.issues);
        throw new ApiException("INTERNAL", "サーバーでエラーが起きました。もう一度お試しください");
      }
      return c.json(checked.data);
    });
  }
}
