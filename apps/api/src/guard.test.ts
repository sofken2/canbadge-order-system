import { afterEach, describe, expect, test } from "bun:test";
import { apiErrorSchema, settingSchema } from "@canbadge/shared";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { createAccessVerifier, localKeys } from "./access";
import { call, createTestApp, type TestApp } from "./test-helpers";

// スタッフ用・モニター用の API を、経路ごとに、使わせる・断る（A05）。
// 鍵は、テストで作った RS256 のもの（Cloudflare Access と同じ形）を差し込む。

const TEAM = "sofken2.cloudflareaccess.com";
const AUD = "test-audience";

const keys = await generateKeyPair("RS256");
const jwk = { ...(await exportJWK(keys.publicKey)), kid: "k1", alg: "RS256", use: "sig" };
const verifier = createAccessVerifier(
  { teamDomain: TEAM, audience: AUD },
  localKeys({ keys: [jwk] }),
);

const token = (audience = AUD) =>
  new SignJWT({ email: "staff@example.com" })
    .setProtectedHeader({ alg: "RS256", kid: "k1" })
    .setIssuer(`https://${TEAM}`)
    .setAudience(audience)
    .setExpirationTime("1h")
    .sign(keys.privateKey);

const STAFF_PATHS = ["/api/staff/settings", "/api/staff/orders", "/api/staff/print-sheets/current"];
const MONITOR_PATH = "/api/monitor/ready";

let t: TestApp | undefined;
afterEach(async () => {
  await t?.close();
  t = undefined;
});

const open = (options: Parameters<typeof createTestApp>[0] = {}) => {
  t = createTestApp(options);
  return t.app;
};

async function message(response: Response): Promise<string> {
  return apiErrorSchema.parse(await response.json()).error.message;
}

describe("Cloudflare 経由（Access の JWT が要る）", () => {
  const cf = { "cf-ray": "abc123-NRT", "cf-connecting-ip": "203.0.113.7" };

  test("正しい JWT があれば、スタッフ用を使える", async () => {
    const app = open({ access: verifier });
    for (const path of STAFF_PATHS) {
      const res = await call(app, "GET", path, {
        headers: { ...cf, "cf-access-jwt-assertion": await token() },
      });
      expect({ path, status: res.status }).toEqual({ path, status: 200 });
    }
  });

  test("JWT がなければ、スタッフ用を 401 で断る", async () => {
    const app = open({ access: verifier });
    for (const path of STAFF_PATHS) {
      const res = await call(app, "GET", path, { headers: cf });
      expect({ path, status: res.status }).toEqual({ path, status: 401 });
    }
  });

  test("ヘッダーの値が、でたらめ・別の Application のものなら、401", async () => {
    const app = open({ access: verifier });
    for (const value of ["true", "abc.def.ghi", await token("other-app")]) {
      const res = await call(app, "GET", "/api/staff/settings", {
        headers: { ...cf, "cf-access-jwt-assertion": value },
      });
      expect({ value: value.slice(0, 12), status: res.status }).toEqual({
        value: value.slice(0, 12),
        status: 401,
      });
    }
  });

  test("状態を変える操作（POST）も、JWT がなければ断る。断った操作は、実行されない", async () => {
    const app = open({ access: verifier });
    const paused = async (): Promise<boolean> => {
      const res = await call(app, "GET", "/api/staff/settings", {
        headers: { ...cf, "cf-access-jwt-assertion": await token() },
      });
      return settingSchema.parse(await res.json()).printPaused;
    };
    const before = await paused();
    const res = await call(app, "POST", "/api/staff/print-queue/pause", { headers: cf });
    expect(res.status).toBe(401);
    expect(await paused()).toBe(before);
  });

  test("SSE（スタッフ用のイベント）も、JWT がなければ 401", async () => {
    const app = open({ access: verifier });
    const res = await call(app, "GET", "/api/staff/events", { headers: cf });
    expect(res.status).toBe(401);
  });

  test("呼び出しモニターは、JWT があっても、Cloudflare 経由では使えない（localhost だけ）", async () => {
    const app = open({ access: verifier });
    const res = await call(app, "GET", MONITOR_PATH, {
      headers: { ...cf, "cf-access-jwt-assertion": await token() },
    });
    expect(res.status).toBe(401);
    expect(await message(res)).toContain("localhost");
  });

  test("Access の設定がないときは、JWT があっても、すべて断る（開けっぱなしにしない）", async () => {
    const app = open({ access: undefined });
    const res = await call(app, "GET", "/api/staff/settings", {
      headers: { ...cf, "cf-access-jwt-assertion": await token() },
    });
    expect(res.status).toBe(401);
    expect(await message(res)).toContain("設定されていない");
  });

  test("来場者向けは、JWT がなくても使える", async () => {
    const app = open({ access: verifier });
    const res = await call(app, "GET", "/api/status", { headers: cf });
    expect(res.status).toBe(200);
  });

  test("断るときの文に、認証の仕組みの詳細（署名・鍵・aud など）を出さない", async () => {
    const app = open({ access: verifier });
    const res = await call(app, "GET", "/api/staff/settings", {
      headers: { ...cf, "cf-access-jwt-assertion": await token("other-app") },
    });
    const text = await message(res);
    for (const leak of ["aud", "署名", "signature", "claim", "other-app", AUD]) {
      expect(text).not.toContain(leak);
    }
  });
});

describe("その PC の中（localhost）", () => {
  test("JWT がなくても、スタッフ用・モニター用を使える", async () => {
    const app = open({ access: verifier, remoteAddress: "127.0.0.1" });
    for (const path of [...STAFF_PATHS, MONITOR_PATH]) {
      const res = await call(app, "GET", path);
      expect({ path, status: res.status }).toEqual({ path, status: 200 });
    }
  });

  test("Caddy 経由（X-Forwarded-For が localhost）でも使える", async () => {
    const app = open({ remoteAddress: "127.0.0.1" });
    const res = await call(app, "GET", "/api/staff/settings", {
      headers: { "x-forwarded-for": "127.0.0.1" },
    });
    expect(res.status).toBe(200);
  });
});

describe("会場の LAN など、その PC の外（Cloudflare を通らない）", () => {
  test("api に直接つないだ LAN のアドレスは、スタッフ用・モニター用とも断る", async () => {
    const app = open({ access: verifier, remoteAddress: "192.168.1.20" });
    for (const path of [...STAFF_PATHS, MONITOR_PATH]) {
      const res = await call(app, "GET", path);
      expect({ path, status: res.status }).toEqual({ path, status: 401 });
    }
  });

  test("Caddy 経由で、X-Forwarded-For が LAN のアドレスでも、断る", async () => {
    const app = open({ remoteAddress: "127.0.0.1" });
    const res = await call(app, "GET", "/api/staff/settings", {
      headers: { "x-forwarded-for": "192.168.1.20" },
    });
    expect(res.status).toBe(401);
  });

  test("X-Forwarded-For の左側を localhost に偽っても、右端が LAN なら断る", async () => {
    const app = open({ remoteAddress: "127.0.0.1" });
    const res = await call(app, "GET", "/api/staff/settings", {
      headers: { "x-forwarded-for": "127.0.0.1, 192.168.1.20" },
    });
    expect(res.status).toBe(401);
  });

  test("LAN の人が、cf-ray を偽って付けても、JWT がなければ断る", async () => {
    const app = open({ access: verifier, remoteAddress: "192.168.1.20" });
    const res = await call(app, "GET", "/api/staff/settings", {
      headers: { "cf-ray": "fake" },
    });
    expect(res.status).toBe(401);
  });

  test("来場者向けは、LAN からも使える", async () => {
    const app = open({ remoteAddress: "192.168.1.20" });
    const res = await call(app, "GET", "/api/status");
    expect(res.status).toBe(200);
  });
});

describe("開発用の許可（ALLOW_UNAUTHENTICATED_STAFF）", () => {
  test("明示したときだけ、すべての経路から、認証なしで使える", async () => {
    const app = open({ allowPublicStaff: true, remoteAddress: "192.168.1.20" });
    const res = await call(app, "GET", "/api/staff/settings", { headers: { "cf-ray": "x" } });
    expect(res.status).toBe(200);
  });
});
