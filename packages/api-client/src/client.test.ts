import { describe, expect, test } from "bun:test";
import { ApiClientError, createApiClient } from "./client";

const ID = "01HZX3V5Q8N4M6T2B9C7D1E0FA";

/** 呼ばれた内容を記録して、決まった応答を返す fetch */
function fakeFetch(respond: (url: string, init: RequestInit) => Response) {
  const calls: { url: string; init: RequestInit }[] = [];
  const impl = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    calls.push({ url: String(input), init });
    return respond(String(input), init);
  }) as typeof fetch;
  return { impl, calls };
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("API の呼び出し", () => {
  test("エンドポイントの名前で呼び、パスの引数を埋め、応答を契約で検証して返す", async () => {
    const { impl, calls } = fakeFetch(() =>
      json({
        acceptance: "open",
        busyMessage: null,
        price: 300,
        kiraFilmPrice: 100,
        maxQuantityPerOrder: 1,
        waitingCount: 2,
      }),
    );
    const client = createApiClient({ fetch: impl });
    const status = await client.call("getStatus");
    expect(status.waitingCount).toBe(2);
    expect(calls[0]).toMatchObject({ url: "/api/status", init: { method: "GET" } });
  });

  test("本体は JSON で送り、query は文字列にして付ける（undefined は付けない）", async () => {
    const { impl, calls } = fakeFetch(() => json({ orderId: ID }));
    const client = createApiClient({ fetch: impl, baseUrl: "http://localhost:3002" });
    await client.call("createOrder", {
      body: {
        imageId: ID,
        editorData: { version: 1 },
        quantity: 1,
        turnstileToken: "t",
        rightsConsent: true,
      },
    });
    expect(calls[0]?.url).toBe("http://localhost:3002/api/orders");
    const headers = (calls[0]?.init.headers ?? {}) as Record<string, string>;
    expect(headers["content-type"]).toBe("application/json");
    expect(JSON.parse(String(calls[0]?.init.body))).toMatchObject({
      quantity: 1,
      rightsConsent: true,
    });

    const search = fakeFetch(() => json({ items: [], nextBefore: null }));
    await createApiClient({ fetch: search.impl }).call("searchStaffOrders", {
      query: { status: "ready,printed", q: undefined, limit: 5 },
    });
    expect(search.calls[0]?.url).toBe("/api/staff/orders?status=ready%2Cprinted&limit=5");
  });

  test("パスの引数が URL に入る", async () => {
    const { impl, calls } = fakeFetch(() =>
      json({
        id: ID,
        businessDate: "2026-11-03",
        orderNumber: 1,
        orderNumberText: "001",
        status: "paid",
        totalAmount: 300,
        createdAt: "2026-11-03T00:00:00.000Z",
        items: [],
      }),
    );
    await createApiClient({ fetch: impl }).call("payOrder", { params: { orderId: ID } });
    expect(calls[0]).toMatchObject({
      url: `/api/staff/orders/${ID}/pay`,
      init: { method: "POST" },
    });
  });

  test("契約に合わない応答は、例外にする（契約と実装のずれに気づける）", async () => {
    const { impl } = fakeFetch(() => json({ acceptance: "unknown" }));
    await expect(createApiClient({ fetch: impl }).call("getStatus")).rejects.toThrow();
  });

  test("失敗の応答は、code と message を持つ ApiClientError にする", async () => {
    const { impl } = fakeFetch(() =>
      json({ error: { code: "NOT_FOUND", message: "注文が見つかりません" } }, 404),
    );
    const error = await createApiClient({ fetch: impl })
      .call("getOrder", { params: { orderId: ID } })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiClientError);
    expect(error).toMatchObject({
      code: "NOT_FOUND",
      status: 404,
      message: "注文が見つかりません",
    });
  });

  test("契約の形でない失敗は INTERNAL、通信できないときは NETWORK", async () => {
    const broken = fakeFetch(() => new Response("<html>", { status: 502 }));
    const a = await createApiClient({ fetch: broken.impl })
      .call("getStatus")
      .catch((e: unknown) => e);
    expect(a).toMatchObject({ code: "INTERNAL", status: 502 });

    const offline = (async () => {
      throw new TypeError("fetch failed");
    }) as unknown as typeof fetch;
    const b = await createApiClient({ fetch: offline })
      .call("getStatus")
      .catch((e: unknown) => e);
    expect(b).toMatchObject({ code: "NETWORK", status: 0 });
  });

  test("JSON でないエンドポイント（画像・PDF）は Response を返す。url でアドレスだけも取れる", async () => {
    const { impl } = fakeFetch(
      () => new Response("png", { headers: { "content-type": "image/png" } }),
    );
    const client = createApiClient({ fetch: impl });
    const res = await client.call("getImage", {
      params: { imageId: ID },
      query: { size: "thumb" },
    });
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(client.url("getImage", { params: { imageId: ID }, query: { size: "thumb" } })).toBe(
      `/api/images/${ID}?size=thumb`,
    );
  });
});

/** EventSource の代わり。受け取ったイベントを、テストから流し込める */
class FakeEventSource {
  static last: FakeEventSource | undefined;
  readonly listeners = new Map<string, ((e: { data: string }) => void)[]>();
  onopen: (() => void) | null = null;
  closed = false;
  constructor(readonly url: string) {
    FakeEventSource.last = this;
  }
  addEventListener(type: string, listener: (e: { data: string }) => void) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }
  emit(type: string, data: unknown) {
    for (const listener of this.listeners.get(type) ?? []) listener({ data: JSON.stringify(data) });
  }
  close() {
    this.closed = true;
  }
}

describe("SSE の購読", () => {
  const client = createApiClient({ eventSource: FakeEventSource as unknown as typeof EventSource });

  test("種類ごとにイベントを受け取り、契約に合うものだけ渡す。つながるたびに onOpen が呼ばれる", () => {
    const received: unknown[] = [];
    let opened = 0;
    client.subscribe("orderEvents", {
      params: { orderId: ID },
      onEvent: (event) => received.push(event),
      onOpen: () => {
        opened += 1;
      },
    });
    const source = FakeEventSource.last;
    expect(source?.url).toBe(`/api/events/orders/${ID}`);

    source?.onopen?.();
    source?.onopen?.();
    expect(opened).toBe(2);

    source?.emit("order.updated", { type: "order.updated", orderId: ID, status: "paid" });
    source?.emit("order.updated", { type: "order.updated", orderId: "bad", status: "paid" });
    source?.emit("queue.updated", { type: "queue.updated" });
    expect(received).toEqual([
      { type: "order.updated", orderId: ID, status: "paid" },
      { type: "queue.updated" },
    ]);
  });

  test("戻り値の関数で、購読をやめられる", () => {
    const stop = client.subscribe("staffEvents", { onEvent: () => undefined });
    expect(FakeEventSource.last?.closed).toBe(false);
    stop();
    expect(FakeEventSource.last?.closed).toBe(true);
  });
});

describe("画像のアップロード", () => {
  test("multipart で送り、画像 ID を返す。失敗は ApiClientError", async () => {
    const { impl, calls } = fakeFetch(() => json({ imageId: ID }));
    const client = createApiClient({ fetch: impl });
    const result = await client.uploadImage(new File(["x"], "a.png", { type: "image/png" }));
    expect(result).toEqual({ imageId: ID });
    expect(calls[0]?.init.method).toBe("POST");
    expect(calls[0]?.init.body).toBeInstanceOf(FormData);
    const sent = calls[0]?.init.body as FormData;
    expect(sent.get("file")).toBeInstanceOf(File);

    const failing = fakeFetch(() =>
      json(
        {
          error: { code: "UNSUPPORTED_MEDIA_TYPE", message: "PNG か JPEG の画像を選んでください" },
        },
        415,
      ),
    );
    const error = await createApiClient({ fetch: failing.impl })
      .uploadImage(new File(["x"], "a.txt"))
      .catch((e: unknown) => e);
    expect(error).toMatchObject({ code: "UNSUPPORTED_MEDIA_TYPE", status: 415 });
  });
});
