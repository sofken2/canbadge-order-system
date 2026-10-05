import {
  apiErrorSchema,
  buildPath,
  type EndpointName,
  type ErrorCode,
  endpoints,
  type ImageUploadResponse,
  type SseEvent,
  sseEventSchema,
} from "@canbadge/shared";
import type { z } from "zod";

// 契約（packages/shared の endpoints）から作る、型付きの API クライアント。
// パスの文字列を画面に直接書かず、エンドポイントの名前で呼ぶ。応答は契約のスキーマで検証する。

type EndpointOf<N extends EndpointName> = (typeof endpoints)[N];

/** params・query・body のスキーマがあるときだけ、その入力の型を求める */
type InputOf<E, K extends "params" | "query" | "body"> =
  E extends Record<K, infer S> ? (S extends z.ZodType ? z.input<S> : never) : never;

type Part<E, K extends "params" | "query" | "body", Key extends string> = [InputOf<E, K>] extends [
  never,
]
  ? { [P in Key]?: never }
  : { [P in Key]: InputOf<E, K> };

/** 呼び出しの入力。契約にある params・body は必須、query は省略できる */
export type CallInput<N extends EndpointName> = Part<EndpointOf<N>, "params", "params"> &
  ([InputOf<EndpointOf<N>, "query">] extends [never]
    ? { query?: never }
    : { query?: InputOf<EndpointOf<N>, "query"> }) &
  Part<EndpointOf<N>, "body", "body">;

/** JSON のエンドポイントは、契約の応答の形。それ以外（画像・PDF・SSE など）は Response */
export type CallOutput<N extends EndpointName> =
  EndpointOf<N> extends { response: infer R }
    ? R extends z.ZodType
      ? z.output<R>
      : Response
    : Response;

/** 失敗した応答（契約の形の { error: { code, message } }）。画面は code で分岐し、message を表示する */
export class ApiClientError extends Error {
  readonly code: ErrorCode | "NETWORK";
  readonly status: number;
  readonly details?: unknown;

  constructor(code: ErrorCode | "NETWORK", message: string, status: number, details?: unknown) {
    super(message);
    this.name = "ApiClientError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export type ApiClientOptions = {
  /** 先頭に付けるアドレス。画面は同じオリジンの /api を呼ぶので、通常は空。テストや別プロセスから使うときに指定する */
  baseUrl?: string;
  fetch?: typeof fetch;
  /** SSE の購読に使う EventSource（ブラウザの標準。テストで差し替える） */
  eventSource?: typeof EventSource;
  /** 付ける HTTP ヘッダー（Cookie など。ブラウザ以外から使うとき） */
  headers?: Record<string, string>;
};

function queryString(query: object | undefined): string {
  if (!query) return "";
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== null) params.set(key, String(value));
  }
  const text = params.toString();
  return text === "" ? "" : `?${text}`;
}

export function createApiClient(options: ApiClientOptions = {}) {
  const baseUrl = options.baseUrl ?? "";
  const doFetch = options.fetch ?? ((...args: Parameters<typeof fetch>) => fetch(...args));

  /** リクエストを送り、失敗の応答（契約の形の { error: ... }）を ApiClientError にして投げる */
  async function send(url: string, init: RequestInit): Promise<Response> {
    let response: Response;
    try {
      response = await doFetch(url, {
        ...init,
        headers: { ...(init.headers as Record<string, string> | undefined), ...options.headers },
      });
    } catch (error) {
      throw new ApiClientError(
        "NETWORK",
        "サーバーにつながりません。通信を確かめてください",
        0,
        error,
      );
    }
    if (response.ok) return response;

    const parsed = apiErrorSchema.safeParse(await response.json().catch(() => undefined));
    if (parsed.success) {
      const { code, message, details } = parsed.data.error;
      throw new ApiClientError(code, message, response.status, details);
    }
    throw new ApiClientError(
      "INTERNAL",
      `サーバーでエラーが起きました（${response.status}）`,
      response.status,
    );
  }

  /** エンドポイントを呼ぶ。失敗は ApiClientError で投げる */
  async function call<N extends EndpointName>(
    name: N,
    input: CallInput<N> = {} as CallInput<N>,
  ): Promise<CallOutput<N>> {
    const endpoint = endpoints[name];
    const { params, query, body } = input as {
      params?: Record<string, string>;
      query?: object;
      body?: unknown;
    };
    const response = await send(baseUrl + buildPath(endpoint.path, params) + queryString(query), {
      method: endpoint.method,
      headers: body === undefined ? {} : { "content-type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (endpoint.response === null) return response as CallOutput<N>;
    return endpoint.response.parse(await response.json()) as unknown as CallOutput<N>;
  }

  /** 画像をアップロードする（multipart）。返ってきた画像 ID を、注文の作成に渡す */
  async function uploadImage(file: File): Promise<ImageUploadResponse> {
    const form = new FormData();
    form.set("file", file);
    const response = await send(baseUrl + endpoints.uploadImage.path, {
      method: endpoints.uploadImage.method,
      body: form,
    });
    return endpoints.uploadImage.response.parse(await response.json());
  }

  /** 画像・PDF など、そのまま表示するもののアドレス */
  function url<N extends EndpointName>(
    name: N,
    input: Pick<CallInput<N>, "params" | "query"> = {} as never,
  ): string {
    const { params, query } = input as { params?: Record<string, string>; query?: object };
    return baseUrl + buildPath(endpoints[name].path, params) + queryString(query);
  }

  /**
   * SSE を購読する。「変わった」ことだけが届くので、受け取ったら REST で取り直す。
   * 接続が切れると、ブラウザが自動で再接続する。つながるたびに onOpen が呼ばれるので、そこでも取り直す
   * （切れている間の変化を取りこぼさないため）。戻り値は、購読をやめる関数
   */
  function subscribe<N extends EndpointName>(
    name: N,
    handlers: {
      params?: Record<string, string>;
      onEvent: (event: SseEvent) => void;
      onOpen?: () => void;
    },
  ): () => void {
    const EventSourceImpl = options.eventSource ?? EventSource;
    const source = new EventSourceImpl(baseUrl + buildPath(endpoints[name].path, handlers.params));
    source.onopen = () => handlers.onOpen?.();
    // サーバーは event: <type> の名前つきで流すので、種類ごとに受け取る
    for (const option of sseEventSchema.options) {
      source.addEventListener(option.shape.type.value, (message) => {
        const parsed = sseEventSchema.safeParse(JSON.parse((message as MessageEvent<string>).data));
        if (parsed.success) handlers.onEvent(parsed.data);
      });
    }
    return () => source.close();
  }

  return { call, uploadImage, url, subscribe };
}

export type ApiClient = ReturnType<typeof createApiClient>;
