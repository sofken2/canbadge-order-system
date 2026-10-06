import { afterEach, describe, expect, test } from "bun:test";
import { encodePng } from "@canbadge/fixtures";
import { apiErrorSchema, staffOrderListResponseSchema } from "@canbadge/shared";
import { LIMITS } from "./abuse";
import { call, createTestApp, type TestApp } from "./test-helpers";
import type { TurnstileResult, TurnstileVerifier } from "./turnstile";

// 乱用対策（A06）：Turnstile のサーバー側の検証、端末あたりの支払い待ちの上限、回数の制限、照会の総当たり対策。

let t: TestApp | undefined;
afterEach(async () => {
  await t?.close();
  t = undefined;
});

/** 呼ばれた内容を覚え、決めた結果を返す、偽の検証器 */
function fakeTurnstile(result: TurnstileResult = { ok: true }) {
  const calls: { token: string; ip: string | undefined }[] = [];
  const verifier: TurnstileVerifier = {
    verify: async (token, ip) => {
      calls.push({ token, ip });
      return result;
    },
  };
  return { verifier, calls };
}

async function errorOf(res: Response) {
  return apiErrorSchema.parse(await res.json()).error;
}

/** 注文の総数（スタッフ用の一覧から）。断られた注文が、作られていないことの確認に使う */
async function orderCount(app: TestApp["app"]): Promise<number> {
  const res = await call(app, "GET", "/api/staff/orders?limit=100");
  return staffOrderListResponseSchema.parse(await res.json()).items.length;
}

async function upload(app: TestApp["app"]): Promise<string> {
  const form = new FormData();
  form.set("file", new File([encodePng(2, 2, new Uint8Array(12))], "a.png", { type: "image/png" }));
  const res = await call(app, "POST", "/api/images", { form });
  return ((await res.json()) as { imageId: string }).imageId;
}

const orderBody = (imageId: string, turnstileToken = "tok") => ({
  imageId,
  editorData: { version: 1 },
  quantity: 1,
  turnstileToken,
  rightsConsent: true,
});

const MISSING_IMAGE = "01HZX3V5Q8N4M6T2B9C7D1E0FA";

describe("Turnstile のサーバー側の検証", () => {
  test("検証に通れば、注文できる。トークンと来場者の IP が、検証器に渡る", async () => {
    const { verifier, calls } = fakeTurnstile();
    t = createTestApp({ turnstile: verifier, remoteAddress: "127.0.0.1" });
    const res = await call(t.app, "POST", "/api/orders", {
      json: orderBody(await upload(t.app), "real-token"),
      headers: { "cf-connecting-ip": "203.0.113.9" },
    });
    expect(res.status).toBe(200);
    expect(calls).toEqual([{ token: "real-token", ip: "203.0.113.9" }]);
  });

  test("検証に失敗したら、注文は作られず、画面に出せる文で断る（仕組みの詳細は出さない）", async () => {
    const { verifier } = fakeTurnstile({
      ok: false,
      reason: "timeout-or-duplicate",
      transient: false,
    });
    const app = createTestApp({ turnstile: verifier });
    t = app;
    const imageId = await upload(app.app);
    const before = await orderCount(app.app);
    const res = await call(app.app, "POST", "/api/orders", { json: orderBody(imageId) });
    expect(res.status).toBe(400);
    const error = await errorOf(res);
    expect(error.code).toBe("VALIDATION_FAILED");
    expect(error.message).toContain("確認に失敗しました");
    expect(JSON.stringify(error)).not.toContain("timeout-or-duplicate");
    expect(error.details).toEqual({ reason: "turnstile" });
    expect(await orderCount(app.app)).toBe(before);
  });

  test("Cloudflare に届かないなど（来場者のせいではない失敗）は、500 で、少し待つよう伝える", async () => {
    const { verifier } = fakeTurnstile({ ok: false, reason: "network down", transient: true });
    t = createTestApp({ turnstile: verifier });
    const res = await call(t.app, "POST", "/api/orders", { json: orderBody(await upload(t.app)) });
    expect(res.status).toBe(500);
    expect((await errorOf(res)).message).toContain("少し待って");
  });

  test("受付停止・支払い待ちの上限で断る注文では、Turnstile のトークンを使わせない", async () => {
    const { verifier, calls } = fakeTurnstile();
    t = createTestApp({ turnstile: verifier });
    const imageId = await upload(t.app);

    await call(t.app, "POST", "/api/staff/acceptance", { json: { acceptance: "busy" } });
    const busy = await call(t.app, "POST", "/api/orders", { json: orderBody(imageId) });
    expect(busy.status).toBe(503);
    expect(calls).toHaveLength(0);
    await call(t.app, "POST", "/api/staff/acceptance", { json: { acceptance: "open" } });

    const first = await call(t.app, "POST", "/api/orders", { json: orderBody(imageId) });
    const cookie = (first.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
    await call(t.app, "POST", "/api/orders", {
      json: orderBody(imageId),
      headers: { cookie },
    });
    const callsBefore = calls.length;
    const limited = await call(t.app, "POST", "/api/orders", {
      json: orderBody(imageId),
      headers: { cookie },
    });
    expect(limited.status).toBe(429);
    expect(calls.length).toBe(callsBefore);
  });

  test("検証器がない（TURNSTILE_SECRET_KEY が未設定の開発環境）ときだけ、検証しない", async () => {
    t = createTestApp();
    const res = await call(t.app, "POST", "/api/orders", {
      json: orderBody(await upload(t.app), "dev-token"),
    });
    expect(res.status).toBe(200);
  });
});

describe("1 端末あたりの支払い待ちの上限", () => {
  test("同じ端末（Cookie）からは、上限（既定 2 件）まで。超えたら 429 RATE_LIMITED", async () => {
    t = createTestApp();
    const imageId = await upload(t.app);
    const first = await call(t.app, "POST", "/api/orders", { json: orderBody(imageId) });
    const cookie = (first.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
    const second = await call(t.app, "POST", "/api/orders", {
      json: orderBody(imageId),
      headers: { cookie },
    });
    expect(second.status).toBe(200);

    const third = await call(t.app, "POST", "/api/orders", {
      json: orderBody(imageId),
      headers: { cookie },
    });
    expect(third.status).toBe(429);
    const error = await errorOf(third);
    expect(error.code).toBe("RATE_LIMITED");
    expect(error.message).toContain("2 件");
    expect(error.message).toContain("支払う");
  });

  test("別の端末（Cookie なし）は、そのまま注文できる", async () => {
    t = createTestApp();
    const imageId = await upload(t.app);
    for (let i = 0; i < 3; i++) {
      const res = await call(t.app, "POST", "/api/orders", { json: orderBody(imageId) });
      expect(res.status).toBe(200);
    }
  });

  test("取り消すと、また注文できる", async () => {
    t = createTestApp();
    const imageId = await upload(t.app);
    const first = await call(t.app, "POST", "/api/orders", { json: orderBody(imageId) });
    const cookie = (first.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
    const orderId = ((await first.json()) as { orderId: string }).orderId;
    await call(t.app, "POST", "/api/orders", { json: orderBody(imageId), headers: { cookie } });
    expect(
      (await call(t.app, "POST", "/api/orders", { json: orderBody(imageId), headers: { cookie } }))
        .status,
    ).toBe(429);
    await call(t.app, "POST", `/api/orders/${orderId}/cancel`, { headers: { cookie } });
    expect(
      (await call(t.app, "POST", "/api/orders", { json: orderBody(imageId), headers: { cookie } }))
        .status,
    ).toBe(200);
  });
});

describe("IP ごとの回数の制限", () => {
  test("注文：上限を超えたら 429 と Retry-After。待てば、また使える。別の IP には影響しない", async () => {
    let now = 1_000_000;
    t = createTestApp({ now: () => now });
    const ip = { "cf-connecting-ip": "198.51.100.1" };
    // 画像が見つからない注文でも、回数に数える（連打を止めるため）
    for (let i = 0; i < LIMITS.orders.limit; i++) {
      const res = await call(t.app, "POST", "/api/orders", {
        json: orderBody(MISSING_IMAGE),
        headers: ip,
      });
      expect(res.status).toBe(400);
    }
    const blocked = await call(t.app, "POST", "/api/orders", {
      json: orderBody(MISSING_IMAGE),
      headers: ip,
    });
    expect(blocked.status).toBe(429);
    expect((await errorOf(blocked)).code).toBe("RATE_LIMITED");
    const retryAfter = Number(blocked.headers.get("retry-after"));
    expect(retryAfter).toBeGreaterThan(0);
    expect(retryAfter).toBeLessThanOrEqual(LIMITS.orders.windowMs / 1000);

    const other = await call(t.app, "POST", "/api/orders", {
      json: orderBody(MISSING_IMAGE),
      headers: { "cf-connecting-ip": "198.51.100.2" },
    });
    expect(other.status).toBe(400);

    now += LIMITS.orders.windowMs + 1000;
    const later = await call(t.app, "POST", "/api/orders", {
      json: orderBody(MISSING_IMAGE),
      headers: ip,
    });
    expect(later.status).toBe(400);
  });

  test("画像のアップロード：上限を超えたら 429", async () => {
    const app = createTestApp();
    t = app;
    const ip = { "cf-connecting-ip": "198.51.100.3" };
    const send = () => {
      const form = new FormData();
      form.set("file", new File(["not an image"], "a.png", { type: "image/png" }));
      return call(app.app, "POST", "/api/images", { form, headers: ip });
    };
    for (let i = 0; i < LIMITS.uploads.limit; i++) expect((await send()).status).not.toBe(429);
    expect((await send()).status).toBe(429);
  });

  test("来場者向けの状態の確認（/api/status）は、制限しない", async () => {
    t = createTestApp();
    for (let i = 0; i < 100; i++) {
      const res = await call(t.app, "GET", "/api/status", {
        headers: { "cf-connecting-ip": "198.51.100.4" },
      });
      expect(res.status).toBe(200);
    }
  });
});

describe("注文照会の総当たり対策", () => {
  const lookup = (app: TestApp["app"], orderNumber: number, confirmationCode: string, ip: string) =>
    call(app, "POST", "/api/orders/lookup", {
      json: { orderNumber, confirmationCode },
      headers: { "cf-connecting-ip": ip },
    });

  test("確認コードを間違え続けると、1 つの IP から、上限で止まる（正しいコードでも通らない）", async () => {
    t = createTestApp();
    const waiting = t.summary.orders.waiting;
    const number = waiting?.orderNumber ?? 0;
    for (let i = 0; i < LIMITS.lookupFailuresByIp.limit; i++) {
      expect((await lookup(t.app, number, "2222", "203.0.113.50")).status).toBe(404);
    }
    const blocked = await lookup(t.app, number, t.confirmationCode("waiting"), "203.0.113.50");
    expect(blocked.status).toBe(429);
    const error = await errorOf(blocked);
    expect(error.message).toContain("間違えています");
    expect(Number(blocked.headers.get("retry-after"))).toBeGreaterThan(0);
  });

  test("IP を変えても、1 つの注文番号への失敗が積み重なると、その番号は止まる（誰からでも）", async () => {
    t = createTestApp();
    const waiting = t.summary.orders.waiting;
    const number = waiting?.orderNumber ?? 0;
    for (let i = 0; i < LIMITS.lookupFailuresByNumber.limit; i++) {
      // 5 つの IP が、順番に、2 回ずつ（IP ごとの上限には、当たらない）
      expect((await lookup(t.app, number, "2222", `192.0.2.${i % 5}`)).status).toBe(404);
    }
    const fresh = await lookup(t.app, number, t.confirmationCode("waiting"), "192.0.2.200");
    expect(fresh.status).toBe(429);
  });

  test("ふつうの来場者（番号と確認コードが合う）は、少しの失敗があっても、照会できる", async () => {
    t = createTestApp();
    const waiting = t.summary.orders.waiting;
    const number = waiting?.orderNumber ?? 0;
    await lookup(t.app, number, "2222", "203.0.113.60");
    await lookup(t.app, number, "3333", "203.0.113.60");
    const ok = await lookup(t.app, number, t.confirmationCode("waiting"), "203.0.113.60");
    expect(ok.status).toBe(200);
  });

  test("存在しない番号への失敗も、数える（番号の有無を、回数の違いから、探れない）", async () => {
    t = createTestApp();
    for (let i = 0; i < LIMITS.lookupFailuresByIp.limit; i++) {
      expect((await lookup(t.app, 9999, "2222", "203.0.113.70")).status).toBe(404);
    }
    expect((await lookup(t.app, 9999, "2222", "203.0.113.70")).status).toBe(429);
  });

  test("失敗は、別の IP の来場者を巻き込まない", async () => {
    t = createTestApp();
    const waiting = t.summary.orders.waiting;
    const number = waiting?.orderNumber ?? 0;
    for (let i = 0; i < LIMITS.lookupFailuresByIp.limit; i++) {
      await lookup(t.app, 9999, "2222", "203.0.113.80");
    }
    const other = await lookup(t.app, number, t.confirmationCode("waiting"), "203.0.113.81");
    expect(other.status).toBe(200);
  });
});
