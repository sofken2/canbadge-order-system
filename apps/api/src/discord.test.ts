import { afterEach, describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";
import { LIMITS } from "./abuse";
import { createDiscordClient, type DiscordConfig, discordConfigFromEnv } from "./discord";
import { call, createTestApp, type TestApp } from "./test-helpers";

// Discord のアイコンの取り込み（W08）。Discord は、偽物（fetch の差し替え）で、本物にはつながない。

const CONFIG: DiscordConfig = {
  clientId: "client-123",
  clientSecret: "secret-shh-456",
  redirectUri: "https://badge.example/api/discord/callback",
};
const USER_ID = "123456789012345678";
const AVATAR = "a_0123456789abcdef0123456789abcdef";
const TOKEN = "access-token-SECRET-789";
const CODE = "auth-code-abc";

type Call = { url: string; method: string; body: string; authorization?: string };

/** 偽の Discord。応答を、テストごとに差し替えられる */
function fakeDiscord(
  overrides: {
    token?: () => Response;
    me?: () => Response;
    cdn?: () => Response;
    fail?: boolean;
  } = {},
) {
  const calls: Call[] = [];
  let avatarPng: Uint8Array | undefined;
  const fetchImpl = (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const url = String(input);
    const headers = (init?.headers ?? {}) as Record<string, string>;
    calls.push({
      url,
      method: init?.method ?? "GET",
      body: String(init?.body ?? ""),
      authorization: headers.authorization,
    });
    if (overrides.fail) throw new Error("ネットワークがない");
    if (url.endsWith("/oauth2/token")) {
      return overrides.token?.() ?? Response.json({ access_token: TOKEN, token_type: "Bearer" });
    }
    if (url.endsWith("/oauth2/token/revoke")) return new Response("{}");
    if (url.endsWith("/users/@me")) {
      return overrides.me?.() ?? Response.json({ id: USER_ID, avatar: AVATAR, username: "tarou" });
    }
    if (url.startsWith("https://cdn.discordapp.com/avatars/")) {
      avatarPng ??= await sharp({
        create: { width: 1024, height: 1024, channels: 3, background: "#4a90d9" },
      })
        .png()
        .toBuffer();
      return (
        overrides.cdn?.() ?? new Response(avatarPng, { headers: { "content-type": "image/png" } })
      );
    }
    return new Response("not found", { status: 404 });
  }) as typeof fetch;
  const client = createDiscordClient(CONFIG, { fetch: fetchImpl, maxAvatarBytes: 10_000_000 });
  return { client, calls, called: (part: string) => calls.filter((c) => c.url.includes(part)) };
}

let t: TestApp | undefined;
afterEach(async () => {
  await t?.close();
  t = undefined;
});

const STATE = "state-from-cookie-0123456789abcdef";
const callback = (test: TestApp, query: string, cookie: string | undefined = STATE) =>
  call(test.app, "GET", `/api/discord/callback?${query}`, {
    headers: cookie ? { cookie: `discord_state=${cookie}` } : {},
  });

const location = (res: Response) => res.headers.get("location") ?? "";

/** 画面に戻るときの、失敗の種類 */
const errorOf = (res: Response) =>
  new URL(location(res), "http://x").searchParams.get("discordError");

describe("許可画面へ（authorize）", () => {
  test("Discord の許可画面へ送る。権限は identify だけ。state を、この端末の Cookie にも持たせる", async () => {
    t = createTestApp({ discord: fakeDiscord().client });
    const res = await call(t.app, "GET", "/api/discord/authorize");
    expect(res.status).toBe(302);

    const url = new URL(location(res));
    expect(`${url.origin}${url.pathname}`).toBe("https://discord.com/api/oauth2/authorize");
    expect(url.searchParams.get("client_id")).toBe("client-123");
    expect(url.searchParams.get("scope")).toBe("identify");
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("redirect_uri")).toBe(CONFIG.redirectUri);
    // クライアントシークレットを、URL に含めない
    expect(location(res)).not.toContain("secret-shh");

    const state = url.searchParams.get("state") ?? "";
    expect(state.length).toBeGreaterThanOrEqual(32);
    const cookie = res.headers.get("set-cookie") ?? "";
    expect(cookie).toContain(`discord_state=${state}`);
    expect(cookie).toMatch(/HttpOnly/i);
    // Discord からリンクで戻ってくるので、Strict では Cookie が付かない
    expect(cookie).toMatch(/SameSite=Lax/i);
    expect(cookie).toContain("Path=/api/discord");
  });

  test("state は、毎回、違う", async () => {
    t = createTestApp({ discord: fakeDiscord().client });
    const states = new Set<string>();
    for (let i = 0; i < 5; i++) {
      const res = await call(t.app, "GET", "/api/discord/authorize");
      states.add(new URL(location(res)).searchParams.get("state") ?? "");
    }
    expect(states.size).toBe(5);
  });

  test("設定（DISCORD_*）がなければ、画面に戻して、使えないと伝える", async () => {
    t = createTestApp();
    const res = await call(t.app, "GET", "/api/discord/authorize");
    expect(res.status).toBe(302);
    expect(location(res)).toBe("/?discordError=unavailable");
    expect(res.headers.get("set-cookie")).toBeNull();
  });
});

describe("許可からの戻り（callback）", () => {
  test("アイコンを取って保存し、画像 ID をつけて、画面に戻す。通常のアップロードと同じように、配信できる", async () => {
    const discord = fakeDiscord();
    t = createTestApp({ discord: discord.client });
    const res = await callback(t, `code=${CODE}&state=${STATE}`);
    expect(res.status).toBe(302);

    const target = new URL(location(res), "http://x");
    expect(target.pathname).toBe("/");
    const imageId = target.searchParams.get("imageId") ?? "";
    expect(imageId).toMatch(/^[0-9A-Z]{26}$/);

    const original = await call(t.app, "GET", `/api/images/${imageId}`);
    expect(original.status).toBe(200);
    expect(original.headers.get("content-type")).toBe("image/png");
    const thumb = await call(t.app, "GET", `/api/images/${imageId}?size=thumb`);
    expect(thumb.headers.get("content-type")).toBe("image/webp");

    // state の Cookie は、使い切り（消す）
    expect(res.headers.get("set-cookie") ?? "").toMatch(/discord_state=;|Max-Age=0/i);
  });

  test("Discord へは、code・クライアント情報・戻り先でトークンを取り、そのトークンで本人を引き、1024px の静止画（.png）を取る", async () => {
    const discord = fakeDiscord();
    t = createTestApp({ discord: discord.client });
    await callback(t, `code=${CODE}&state=${STATE}`);

    const exchange = discord.called("/oauth2/token").find((c) => c.method === "POST");
    const form = new URLSearchParams(exchange?.body);
    expect(Object.fromEntries(form)).toMatchObject({
      client_id: "client-123",
      client_secret: "secret-shh-456",
      grant_type: "authorization_code",
      code: CODE,
      redirect_uri: CONFIG.redirectUri,
    });
    expect(discord.called("/users/@me")[0]?.authorization).toBe(`Bearer ${TOKEN}`);
    // 動くアイコン（a_ 付き）でも、.png を指定して、静止画で取る
    expect(discord.called("cdn.discordapp.com")[0]?.url).toBe(
      `https://cdn.discordapp.com/avatars/${USER_ID}/${AVATAR}.png?size=1024`,
    );
  });

  test("使い終わったトークンは、Discord 側で失効させる", async () => {
    const discord = fakeDiscord();
    t = createTestApp({ discord: discord.client });
    await callback(t, `code=${CODE}&state=${STATE}`);
    const revoke = discord.called("/oauth2/token/revoke")[0];
    expect(new URLSearchParams(revoke?.body).get("token")).toBe(TOKEN);
  });

  test("Discord の ID・トークン・code は、DB にも、画像の置き場にも、残らない", async () => {
    t = createTestApp({ discord: fakeDiscord().client });
    await callback(t, `code=${CODE}&state=${STATE}`);
    t.db.sqlite.run("PRAGMA wal_checkpoint(TRUNCATE)");

    const secrets = [USER_ID, TOKEN, CODE, AVATAR, "secret-shh", "tarou"];
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) walk(path);
        else files.push(path);
      }
    };
    walk(t.dir);
    expect(files.some((f) => f.endsWith("app.db"))).toBe(true);
    for (const file of files) {
      const text = readFileSync(file).toString("latin1");
      for (const secret of secrets) {
        expect({ file: file.slice(t.dir.length), secret, found: text.includes(secret) }).toEqual({
          file: file.slice(t.dir.length),
          secret,
          found: false,
        });
      }
    }
  });

  test("失敗しても、ログに、トークン・code・ID は出ない", async () => {
    const discord = fakeDiscord({ cdn: () => new Response("x", { status: 500 }) });
    t = createTestApp({ discord: discord.client });
    const logged: string[] = [];
    const original = console.warn;
    console.warn = (...args: unknown[]) => logged.push(args.map(String).join(" "));
    try {
      await callback(t, `code=${CODE}&state=${STATE}`);
    } finally {
      console.warn = original;
    }
    const all = logged.join("\n");
    expect(all).toContain("unavailable");
    for (const secret of [TOKEN, CODE, USER_ID, "secret-shh"]) expect(all).not.toContain(secret);
  });
});

describe("戻りの確認（state）", () => {
  test("state が、Cookie と違うなら、Discord へ何も聞かずに、断る（他人が用意した戻りを、受け付けない）", async () => {
    const discord = fakeDiscord();
    t = createTestApp({ discord: discord.client });
    const res = await callback(t, `code=${CODE}&state=ほかの人の-state`);
    expect(location(res)).toBe("/?discordError=state");
    expect(discord.calls).toEqual([]);
  });

  test("Cookie がない（期限切れ・別の端末）なら、断る", async () => {
    const discord = fakeDiscord();
    t = createTestApp({ discord: discord.client });
    const res = await callback(t, `code=${CODE}&state=${STATE}`, "");
    expect(errorOf(res)).toBe("state");
    expect(discord.calls).toEqual([]);
  });

  test("state か code がなければ、断る", async () => {
    const discord = fakeDiscord();
    t = createTestApp({ discord: discord.client });
    expect(errorOf(await callback(t, `code=${CODE}`))).toBe("state");
    expect(errorOf(await callback(t, `state=${STATE}`))).toBe("state");
    expect(errorOf(await callback(t, ""))).toBe("state");
    expect(discord.calls).toEqual([]);
  });
});

describe("失敗したときは、画面に戻して、理由を伝える", () => {
  test("来場者が、許可を拒否した（access_denied）", async () => {
    const discord = fakeDiscord();
    t = createTestApp({ discord: discord.client });
    const res = await callback(t, `error=access_denied&state=${STATE}`);
    expect(location(res)).toBe("/?discordError=denied");
    expect(discord.calls).toEqual([]);
  });

  test("ほかのエラー（Discord 側）は、unavailable", async () => {
    t = createTestApp({ discord: fakeDiscord().client });
    const res = await callback(t, `error=server_error&state=${STATE}`);
    expect(errorOf(res)).toBe("unavailable");
  });

  test("アイコンが未設定（avatar が null）なら、no_avatar。トークンは、失効させる", async () => {
    const discord = fakeDiscord({ me: () => Response.json({ id: USER_ID, avatar: null }) });
    t = createTestApp({ discord: discord.client });
    const res = await callback(t, `code=${CODE}&state=${STATE}`);
    expect(errorOf(res)).toBe("no_avatar");
    expect(discord.called("/oauth2/token/revoke")).toHaveLength(1);
    expect(discord.called("cdn.discordapp.com")).toHaveLength(0);
  });

  test("code が使えない（使用済み・期限切れ・400）なら、state と同じ「やり直し」", async () => {
    t = createTestApp({
      discord: fakeDiscord({
        token: () => Response.json({ error: "invalid_grant" }, { status: 400 }),
      }).client,
    });
    expect(errorOf(await callback(t, `code=${CODE}&state=${STATE}`))).toBe("state");
  });

  test("Discord が落ちている（5xx）・つながらない・遅すぎる は、unavailable", async () => {
    t = createTestApp({
      discord: fakeDiscord({ token: () => new Response("", { status: 503 }) }).client,
    });
    expect(errorOf(await callback(t, `code=${CODE}&state=${STATE}`))).toBe("unavailable");
    await t.close();

    t = createTestApp({ discord: fakeDiscord({ fail: true }).client });
    expect(errorOf(await callback(t, `code=${CODE}&state=${STATE}`))).toBe("unavailable");
  });

  test("Discord の応答の形が想定と違う（ID・アイコンのハッシュが、パスを書き換えようとする）なら、取りに行かない", async () => {
    const discord = fakeDiscord({
      me: () => Response.json({ id: USER_ID, avatar: "../../../etc/passwd" }),
    });
    t = createTestApp({ discord: discord.client });
    expect(errorOf(await callback(t, `code=${CODE}&state=${STATE}`))).toBe("unavailable");
    expect(discord.called("cdn.discordapp.com")).toHaveLength(0);
  });

  test("取った画像が、画像でない・壊れているなら、image。保存されない", async () => {
    t = createTestApp({
      discord: fakeDiscord({ cdn: () => new Response("これは画像ではありません") }).client,
    });
    const before = readdirSync(join(t.dir, "images")).sort();
    const res = await callback(t, `code=${CODE}&state=${STATE}`);
    expect(errorOf(res)).toBe("image");
    expect(readdirSync(join(t.dir, "images")).sort()).toEqual(before);
  });

  test("画像が大きすぎるなら、image（容量の上限は、通常のアップロードと同じ）", async () => {
    t = createTestApp({
      discord: fakeDiscord({
        cdn: () => new Response("x", { headers: { "content-length": "999999999" } }),
      }).client,
    });
    expect(errorOf(await callback(t, `code=${CODE}&state=${STATE}`))).toBe("image");
  });

  test("短い間に何度も試すと、rate（画像のアップロードと同じ回数の制限）", async () => {
    const discord = fakeDiscord({ me: () => Response.json({ id: USER_ID, avatar: null }) });
    t = createTestApp({ discord: discord.client });
    let last: string | null = null;
    for (let i = 0; i <= LIMITS.uploads.limit; i++) {
      last = errorOf(await callback(t, `code=${CODE}&state=${STATE}`));
    }
    expect(last).toBe("rate");
  });
});

describe("設定", () => {
  test("DISCORD_CLIENT_ID・DISCORD_CLIENT_SECRET・DISCORD_REDIRECT_URI が、3 つそろったときだけ、使える", () => {
    const all = {
      DISCORD_CLIENT_ID: "a",
      DISCORD_CLIENT_SECRET: "b",
      DISCORD_REDIRECT_URI: "https://x/api/discord/callback",
    };
    expect(discordConfigFromEnv(all)).toEqual({
      clientId: "a",
      clientSecret: "b",
      redirectUri: "https://x/api/discord/callback",
    });
    expect(discordConfigFromEnv({ ...all, DISCORD_CLIENT_SECRET: " " })).toBeUndefined();
    expect(discordConfigFromEnv({ ...all, DISCORD_REDIRECT_URI: undefined })).toBeUndefined();
    expect(discordConfigFromEnv({})).toBeUndefined();
  });
});
