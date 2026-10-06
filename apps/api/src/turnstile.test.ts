import { describe, expect, test } from "bun:test";
import { createTurnstileVerifier } from "./turnstile";

/** 呼ばれた内容を覚え、決めた応答を返す、偽の fetch */
function fakeFetch(respond: () => Response | Promise<Response>) {
  const calls: { url: string; body: URLSearchParams }[] = [];
  const fn = (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    calls.push({ url: String(input), body: init?.body as URLSearchParams });
    return await respond();
  }) as typeof fetch;
  return { fn, calls };
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("Turnstile の検証", () => {
  test("成功：Cloudflare の siteverify に、シークレット・トークン・IP を送る", async () => {
    const { fn, calls } = fakeFetch(() => json({ success: true }));
    const verifier = createTurnstileVerifier({ secret: "sekret", fetch: fn });
    expect(await verifier.verify("tok123", "203.0.113.7")).toEqual({ ok: true });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe("https://challenges.cloudflare.com/turnstile/v0/siteverify");
    expect(calls[0]?.body.get("secret")).toBe("sekret");
    expect(calls[0]?.body.get("response")).toBe("tok123");
    expect(calls[0]?.body.get("remoteip")).toBe("203.0.113.7");
  });

  test("IP がなければ、remoteip は送らない", async () => {
    const { fn, calls } = fakeFetch(() => json({ success: true }));
    await createTurnstileVerifier({ secret: "s", fetch: fn }).verify("tok");
    expect(calls[0]?.body.has("remoteip")).toBe(false);
  });

  test("失敗（success: false）：来場者の失敗として返す。エラーコードは理由に入る", async () => {
    const { fn } = fakeFetch(() =>
      json({ success: false, "error-codes": ["timeout-or-duplicate"] }),
    );
    const result = await createTurnstileVerifier({ secret: "s", fetch: fn }).verify("used");
    expect(result).toEqual({ ok: false, reason: "timeout-or-duplicate", transient: false });
  });

  test("シークレットの間違い（こちらの設定の誤り）は、来場者のせいではない失敗として返す", async () => {
    const { fn } = fakeFetch(() =>
      json({ success: false, "error-codes": ["invalid-input-secret"] }),
    );
    const result = await createTurnstileVerifier({ secret: "bad", fetch: fn }).verify("tok");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.transient).toBe(true);
  });

  test("success が true でない形（文字列の 'true' など）は、通さない", async () => {
    for (const body of [{ success: "true" }, { success: 1 }, {}, [], "ok"]) {
      const { fn } = fakeFetch(() => json(body));
      const result = await createTurnstileVerifier({ secret: "s", fetch: fn }).verify("tok");
      expect({ body, ok: result.ok }).toEqual({ body, ok: false });
    }
  });

  test("Cloudflare に届かない・エラー応答・JSON でない応答は、通さない（一時的な失敗）", async () => {
    const cases: (() => Response | Promise<Response>)[] = [
      () => {
        throw new Error("network down");
      },
      () => json({ success: true }, 500),
      () => new Response("<html>oops</html>", { status: 200 }),
    ];
    for (const respond of cases) {
      const { fn } = fakeFetch(respond);
      const result = await createTurnstileVerifier({ secret: "s", fetch: fn }).verify("tok");
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.transient).toBe(true);
    }
  });

  test("空・長すぎるトークンは、Cloudflare に送らずに断る", async () => {
    const { fn, calls } = fakeFetch(() => json({ success: true }));
    const verifier = createTurnstileVerifier({ secret: "s", fetch: fn });
    expect((await verifier.verify("")).ok).toBe(false);
    expect((await verifier.verify("x".repeat(2049))).ok).toBe(false);
    expect(calls).toHaveLength(0);
    expect((await verifier.verify("x".repeat(2048))).ok).toBe(true);
  });
});
