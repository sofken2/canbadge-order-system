import { afterEach, describe, expect, test } from "bun:test";
import { setAcceptance } from "@canbadge/db";
import { createEventHub } from "./events";
import { call, createTestApp, openSse, type TestApp } from "./test-helpers";

// SSE の本番化（A03）：ハートビート・接続の後始末・定期実行の頑丈さ。

let t: TestApp | undefined;
afterEach(async () => {
  await t?.close();
  t = undefined;
});

const count = (text: string, needle: string) => text.split(needle).length - 1;

describe("ハートビート", () => {
  test("接続したあと、決めた間隔で、空のコメント行（: ping）が届く（Cloudflare・プロキシに、接続を切られないため）", async () => {
    t = createTestApp({ sseHeartbeatMs: 40 });
    const sse = await openSse(t.app, "/api/staff/events");
    const text = await sse.readMore((received) => count(received, ": ping") >= 3, 3000);
    expect(count(text, ": ping")).toBeGreaterThanOrEqual(3);
    await sse.close();
  });

  test("ハートビートは、イベントとしては届かない（コメント行なので、画面の取り直しを起こさない）", async () => {
    t = createTestApp({ sseHeartbeatMs: 30 });
    const sse = await openSse(t.app, "/api/events/orders/01HZX3V5Q8N4M6T2B9C7D1E0FA");
    const text = await sse.readMore((received) => count(received, ": ping") >= 2, 3000);
    expect(text).not.toContain("event:");
    expect(text).not.toContain("data:");
    await sse.close();
  });

  test("既定の間隔は、Cloudflare の 100 秒より、十分に短い（20 秒）", async () => {
    const { DEFAULT_SSE_HEARTBEAT_MS } = await import("./handlers/sse");
    expect(DEFAULT_SSE_HEARTBEAT_MS).toBe(20_000);
    expect(DEFAULT_SSE_HEARTBEAT_MS).toBeLessThan(100_000 / 2);
  });
});

describe("接続の作法", () => {
  test("最初に、接続できたことと、つなぎ直しの待ち（retry）を知らせる。イベントの形（text/event-stream）で返す", async () => {
    t = createTestApp();
    const sse = await openSse(t.app, "/api/staff/events");
    expect(sse.response.headers.get("content-type")).toContain("text/event-stream");
    expect(sse.response.headers.get("cache-control")).toContain("no-cache");
    expect(sse.received()).toContain(": connected");
    expect(sse.received()).toContain("retry: 3000");
    await sse.close();
  });

  test("スタッフ用・モニター用・注文ごとの、どの購読でも、同じ作法で、始まる", async () => {
    t = createTestApp();
    for (const path of [
      "/api/staff/events",
      "/api/monitor/events",
      "/api/events/orders/01HZX3V5Q8N4M6T2B9C7D1E0FA",
    ]) {
      const sse = await openSse(t.app, path);
      expect({ path, ok: sse.received().includes("retry: 3000") }).toEqual({ path, ok: true });
      await sse.close();
    }
  });
});

describe("接続の後始末", () => {
  test("接続を閉じると、購読が外れる（接続の数が、元に戻る）", async () => {
    t = createTestApp({ sseHeartbeatMs: 30 });
    expect(t.events.listenerCount()).toBe(0);
    const a = await openSse(t.app, "/api/staff/events");
    const b = await openSse(t.app, "/api/monitor/events");
    expect(t.events.listenerCount()).toBe(2);

    await a.close();
    await b.close();
    // 閉じたことが、サーバーに伝わるのを、少し待つ
    for (let i = 0; i < 40 && t.events.listenerCount() > 0; i++) await Bun.sleep(50);
    expect(t.events.listenerCount()).toBe(0);
  });

  test("/api/health に、いまの SSE の接続の数が出る（運用で、接続が溜まっていないかを見られる）", async () => {
    t = createTestApp();
    const before = (await (await call(t.app, "GET", "/api/health")).json()) as {
      sseConnections: number;
    };
    expect(before.sseConnections).toBe(0);
    const sse = await openSse(t.app, "/api/staff/events");
    const during = (await (await call(t.app, "GET", "/api/health")).json()) as {
      sseConnections: number;
    };
    expect(during.sseConnections).toBe(1);
    await sse.close();
  });

  test("閉じたあと、ハートビートのタイマーは止まる（書き込みの失敗で、例外が出続けない）", async () => {
    t = createTestApp({ sseHeartbeatMs: 20 });
    const sse = await openSse(t.app, "/api/staff/events");
    await sse.close();
    const errors: unknown[] = [];
    const original = console.error;
    console.error = (...args: unknown[]) => errors.push(args);
    try {
      await Bun.sleep(300);
    } finally {
      console.error = original;
    }
    expect(errors).toEqual([]);
  });
});

describe("定期実行の頑丈さ", () => {
  test("操作ログを読めなくても（DB が使えない）、例外を外に出さず、api を落とさない", () => {
    t = createTestApp();
    const hub = createEventHub(t.db, { intervalMs: 0 });
    t.db.close();
    const original = console.error;
    const logged: unknown[] = [];
    console.error = (...args: unknown[]) => logged.push(args);
    try {
      expect(() => hub.poll()).not.toThrow();
    } finally {
      console.error = original;
      hub.stop();
    }
    expect(logged.length).toBeGreaterThan(0);
  });

  test("1 つの接続への配信が失敗しても、ほかの接続には、届く", () => {
    t = createTestApp();
    const hub = createEventHub(t.db, { intervalMs: 0 });
    const received: string[] = [];
    hub.subscribe(() => {
      throw new Error("この接続は壊れている");
    });
    hub.subscribe((event) => received.push(event.type));
    // 操作ログに、1 行を足す（受付状態の変更）
    setAcceptance(t.db, { acceptance: "busy", actor: "staff" });
    const original = console.error;
    console.error = () => undefined;
    try {
      hub.poll();
    } finally {
      console.error = original;
      hub.stop();
    }
    expect(received).toContain("settings.updated");
  });

  test("接続の数は、購読した数と、外した数で、正しく増減する", () => {
    t = createTestApp();
    const hub = createEventHub(t.db, { intervalMs: 0 });
    const off1 = hub.subscribe(() => undefined);
    const off2 = hub.subscribe(() => undefined);
    expect(hub.listenerCount()).toBe(2);
    off1();
    off1(); // 2 回外しても、壊れない
    expect(hub.listenerCount()).toBe(1);
    off2();
    expect(hub.listenerCount()).toBe(0);
    hub.stop();
  });
});
