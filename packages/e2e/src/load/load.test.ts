import { describe, expect, setDefaultTimeout, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startStack } from "../processes";
import { loadConfigSchema, parseArgs } from "./config";
import {
  adviceFor,
  buildReport,
  capacityOf,
  checkInvariants,
  type FinalState,
  formatReport,
  stageTimes,
} from "./report";
import { runLoad } from "./run";
import { between, createClock, createQueue, createRandom, exponential, jitter } from "./sim";
import { endpointLabel, formatDuration, percentile, summarize, summarizeCalls } from "./stats";
import { createWorld, type OrderRecord } from "./world";

setDefaultTimeout(120_000);

describe("集計", () => {
  test("パーセンタイル：最も近い順位。小さい標本でも、実際にあった値が返る", () => {
    const values = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
    expect(percentile(values, 50)).toBe(50);
    expect(percentile(values, 95)).toBe(100);
    expect(percentile(values, 0)).toBe(10);
    expect(percentile([7], 99)).toBe(7);
    expect(Number.isNaN(percentile([], 50))).toBe(true);
  });

  test("まとめ：件数・最小・平均・パーセンタイル・最大。並べ替えても、元の配列は変えない", () => {
    const input = [5, 1, 3];
    const result = summarize(input);
    expect(result).toMatchObject({ count: 3, min: 1, max: 5, p50: 3 });
    expect(result.mean).toBeCloseTo(3, 9);
    expect(input).toEqual([5, 1, 3]);
    expect(summarize([]).count).toBe(0);
  });

  test("エンドポイントの名前：ID（ULID）を :id にまとめ、クエリは外す", () => {
    expect(
      endpointLabel("post", "http://x/api/staff/orders/01M48QV6P2H6YWQS9K9CV9Z6FQ/pay?x=1"),
    ).toBe("POST /api/staff/orders/:id/pay");
    expect(endpointLabel("GET", "/api/staff/orders?limit=10")).toBe("GET /api/staff/orders");
  });

  test("呼び出しの集計：エンドポイントごと。2xx 以外は、ステータスごとに数える", () => {
    const stats = summarizeCalls([
      { label: "A", ms: 10, status: 200 },
      { label: "A", ms: 30, status: 409 },
      { label: "A", ms: 20, status: "network-error" },
      { label: "B", ms: 5, status: 201 },
    ]);
    const a = stats.find((s) => s.label === "A");
    expect(a).toMatchObject({ count: 3, ok: 1, failures: { "409": 1, "network-error": 1 } });
    expect(stats[0]?.label).toBe("A"); // 多い順
  });

  test("時間の言い方", () => {
    expect(formatDuration(45)).toBe("45 秒");
    expect(formatDuration(60)).toBe("1 分");
    expect(formatDuration(200)).toBe("3 分 20 秒");
    expect(formatDuration(Number.NaN)).toBe("-");
  });
});

describe("シミュレーションの道具", () => {
  test("乱数：同じ種なら同じ並び（再現できる）。違う種なら違う。0 以上 1 未満", () => {
    const a = createRandom(1);
    const b = createRandom(1);
    const c = createRandom(2);
    const seqA = Array.from({ length: 20 }, () => a());
    expect(seqA).toEqual(Array.from({ length: 20 }, () => b()));
    expect(seqA).not.toEqual(Array.from({ length: 20 }, () => c()));
    for (const v of seqA) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  test("指数分布の間隔は、平均がほぼ mean。ばらつきの値は、範囲内", () => {
    const random = createRandom(7);
    const gaps = Array.from({ length: 5000 }, () => exponential(random, 12));
    const mean = gaps.reduce((s, v) => s + v, 0) / gaps.length;
    expect(mean).toBeGreaterThan(11);
    expect(mean).toBeLessThan(13);
    for (let i = 0; i < 200; i++) {
      const j = jitter(random, 100, 0.4);
      expect(j).toBeGreaterThanOrEqual(60);
      expect(j).toBeLessThanOrEqual(140);
      const b = between(random, 15, 90);
      expect(b).toBeGreaterThanOrEqual(15);
      expect(b).toBeLessThanOrEqual(90);
    }
  });

  test("時間の圧縮：仮想の秒を、speed 倍の速さで進める", async () => {
    const clock = createClock(100);
    const before = Date.now();
    await clock.sleep(5); // 仮想の 5 秒 = 実際の 50ms
    const real = Date.now() - before;
    expect(real).toBeGreaterThanOrEqual(40);
    expect(real).toBeLessThan(500);
    expect(clock.toVirtual(1000)).toBe(100);
  });

  test("順番待ちの列：先に入ったものから。空なら、入るまで待つ。閉じたら、待っている人を終わらせる", async () => {
    const queue = createQueue<number>();
    queue.push(1);
    queue.push(2);
    expect(queue.length).toBe(2);
    expect(await queue.take()).toBe(1);
    expect(await queue.take()).toBe(2);

    const waiting = queue.take();
    queue.push(3);
    expect(await waiting).toBe(3);

    const lastWaiter = queue.take();
    queue.close();
    expect(await lastWaiter).toBeUndefined();
    expect(await queue.take()).toBeUndefined();
  });
});

describe("設定", () => {
  test("引数なしなら、既定値。名前は、ハイフンでも、= でも書ける", () => {
    expect(parseArgs([])).toEqual(loadConfigSchema.parse({}));
    const config = parseArgs(["--visitors", "50", "--arrival-minutes=10", "--assemblers", "5"]);
    expect(config).toMatchObject({ visitors: 50, arrivalMinutes: 10, assemblers: 5 });
  });

  test("知らない名前・値のない引数・形の違う値・矛盾は、分かる文で断る", () => {
    expect(() => parseArgs(["--nope", "1"])).toThrow("知らない引数");
    expect(() => parseArgs(["--visitors"])).toThrow("値がありません");
    expect(() => parseArgs(["--visitors", "abc"])).toThrow("--visitors");
    expect(() => parseArgs(["--visitors", "0"])).toThrow("--visitors");
    expect(() => parseArgs(["positional"])).toThrow("形が正しくありません");
    expect(() => parseArgs(["--walk-min-seconds", "100", "--walk-max-seconds", "10"])).toThrow(
      "以下",
    );
    expect(() => parseArgs(["--assemblers", "0"])).toThrow("1 人以上");
  });

  test("動いているサーバー（--target）には、明示の了解（--yes-write-to-target）がなければ、流さない", () => {
    expect(() => parseArgs(["--target", "http://localhost:3002"])).toThrow("--yes-write-to-target");
    const config = parseArgs(["--target", "http://localhost:3002", "--yes-write-to-target"]);
    expect(config).toMatchObject({ target: "http://localhost:3002", yesWriteToTarget: true });
    // 了解の旗は、値なしで書ける。ほかの引数と、並べても、値を食わない
    expect(parseArgs(["--yes-write-to-target", "--visitors", "5"]).visitors).toBe(5);
  });
});

/** 理想的な 1 件の記録 */
function record(index: number, overrides: Partial<OrderRecord> = {}): OrderRecord {
  const base = index * 10;
  return {
    index,
    orderNumber: index,
    at: {
      submitted: base,
      paid: base + 60,
      printed: base + 180,
      assembling: base + 240,
      ready: base + 340,
      picked_up: base + 500,
    },
    actionRealMs: {},
    sseDelayMs: {},
    reprinted: false,
    finished: true,
    lastSeenStatus: "picked_up",
    ...overrides,
  };
}

const goodState = (count: number): FinalState => ({
  orders: Array.from({ length: count }, (_, i) => ({ orderNumber: i + 1, status: "picked_up" })),
  price: 300,
  sales: { paidCount: count, paidAmount: count * 300, refundedCount: 0, netAmount: count * 300 },
  sheets: [{ id: "S1", status: "confirmed", slots: [{ orderNumber: 1, result: "ok" }] }],
  slotsPerSheet: 6,
});

describe("結果の組み立て", () => {
  test("各段階の待ち時間：段階ごとの時刻の差", () => {
    const times = stageTimes([record(1), record(2)]);
    expect(times.toPaid.mean).toBe(60);
    expect(times.printWait.mean).toBe(120);
    expect(times.assemblyWait.mean).toBe(60);
    expect(times.assembleWork.mean).toBe(100);
    expect(times.pickupWait.mean).toBe(160);
    expect(times.endToEnd.mean).toBe(500);
  });

  test("処理能力：人数と作業時間から、1 時間の数。いちばん小さい段階が、ボトルネック", () => {
    const config = loadConfigSchema.parse({});
    const capacity = capacityOf(config, 6);
    expect(capacity.perHour.cashier).toBeCloseTo((2 * 3600) / 25, 6);
    expect(capacity.perHour.assembly).toBeCloseTo((3 * 3600) / 100, 6);
    expect(capacity.perHour.pickup).toBeCloseTo(3600 / 20, 6);
    expect(capacity.bottleneck).toBe("assembly");
    expect(capacity.overallPerHour).toBeCloseTo(108, 6);
    // 組み立てを増やすと、ボトルネックが、別の段階に移る
    const more = capacityOf(loadConfigSchema.parse({ assemblers: 10 }), 6);
    expect(more.bottleneck).not.toBe("assembly");
  });

  test("整合性：すべて正しければ、すべて OK", () => {
    const orders = [record(1), record(2), record(3)];
    const result = checkInvariants(orders, goodState(3), { sseErrors: 0 });
    expect(result.filter((r) => !r.ok)).toEqual([]);
  });

  test("整合性：番号の重複・欠け、取りこぼし、状態の遅れ、売上のずれ、印刷中が 2 枚、を見つける", () => {
    const orders = [record(1), record(2), record(3)];
    const broken: FinalState = {
      ...goodState(3),
      // 番号が 1, 1, 3（重複と欠け）。注文 2 の状態は、模擬の記録より遅れている
      orders: [
        { orderNumber: 1, status: "picked_up" },
        { orderNumber: 1, status: "paid" },
        { orderNumber: 3, status: "picked_up" },
      ],
      sales: { paidCount: 2, paidAmount: 600, refundedCount: 0, netAmount: 600 },
      sheets: [
        { id: "A", status: "printing", slots: [{ orderNumber: 1, result: "pending" }] },
        { id: "B", status: "printing", slots: [{ orderNumber: 2, result: "pending" }] },
      ],
    };
    const failed = checkInvariants(orders, broken, { sseErrors: 3 })
      .filter((r) => !r.ok)
      .map((r) => r.name);
    expect(failed.some((n) => n.includes("注文番号"))).toBe(true);
    expect(failed.some((n) => n.includes("遅れていない"))).toBe(true);
    expect(failed.some((n) => n.includes("売上"))).toBe(true);
    expect(failed.some((n) => n.includes("同時に 1 枚"))).toBe(true);
    expect(failed.some((n) => n.includes("SSE"))).toBe(true);
  });

  test("整合性：1 枚に面付け数を超えて載ったシートと、同じ注文が 2 回載ったシートを、見つける", () => {
    const orders = [record(1)];
    const state: FinalState = {
      ...goodState(1),
      sheets: [
        {
          id: "A",
          status: "confirmed",
          slots: Array.from({ length: 7 }, (_, i) => ({ orderNumber: i + 1, result: "ok" })),
        },
        {
          id: "B",
          status: "confirmed",
          slots: [
            { orderNumber: 1, result: "ok" },
            { orderNumber: 1, result: "ok" },
          ],
        },
      ],
    };
    const result = checkInvariants(orders, state, { sseErrors: 0 });
    expect(result.find((r) => r.name.includes("面付け数"))?.ok).toBe(false);
  });

  test("整合性：模擬の作業が失敗した注文があれば、報告する", () => {
    const orders = [record(1, { failure: "支払い待ちの注文 1 が見つかりません" })];
    const result = checkInvariants(orders, goodState(1), { sseErrors: 0 });
    expect(result.find((r) => r.name.includes("エラーで止まっていない"))?.ok).toBe(false);
  });

  test("助言：来場が処理能力を上回れば、たまる数と、止めどきの目安を言う。余裕があれば、そう言う", () => {
    const busy = loadConfigSchema.parse({ visitors: 300, arrivalMinutes: 20, assemblers: 2 });
    const world = createWorld(busy, createClock(1), "http://x");
    const report = buildReport(world, goodState(0), 1);
    const text = adviceFor(report).join("\n");
    expect(text).toContain("ボトルネック");
    expect(text).toContain("上回っている");
    expect(text).toContain("未完成のまま残る");
    expect(text).toContain("受付を止める目安");

    const relaxed = loadConfigSchema.parse({ visitors: 5, arrivalMinutes: 60 });
    const calm = adviceFor(
      buildReport(createWorld(relaxed, createClock(1), "http://x"), goodState(0), 1),
    );
    expect(calm.join("\n")).not.toContain("上回っている");
  });

  test("報告の文章：主な見出しがそろう（端末に出せる）", () => {
    const world = createWorld(loadConfigSchema.parse({}), createClock(30), "http://x");
    const text = formatReport(buildReport(world, goodState(0), 10));
    for (const heading of [
      "[件数]",
      "[待ち時間",
      "[稼働率]",
      "[サーバー",
      "[整合性の確認]",
      "[見直しのたたき台]",
    ]) {
      expect(text).toContain(heading);
    }
  });
});

describe("実際に流す（小さな規模）", () => {
  test("api と print-worker を起動し、注文から受け渡しまで、整合性を保って終わる", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "canbadge-load-test-"));
    const stack = await startStack(dataDir, {
      SSE_POLL_MS: "50",
      PRINT_POLL_MS: "100",
      PRINT_WAIT_OVERRIDE_SECONDS: "1",
    });
    try {
      const config = loadConfigSchema.parse({
        visitors: 10,
        arrivalMinutes: 3,
        speed: 120,
        cashiers: 2,
        assemblers: 3,
        assembleServiceSeconds: 30,
        printSeconds: 10,
        checkServiceSeconds: 5,
        walkMinSeconds: 5,
        walkMaxSeconds: 20,
        pickupMinDelaySeconds: 5,
        pickupMaxDelaySeconds: 30,
        drainMinutes: 60,
        seed: 3,
      });
      const report = await runLoad(config, { baseUrl: stack.baseUrl });
      const broken = report.invariants.filter((i) => !i.ok);
      expect(broken).toEqual([]);
      expect(report.counts).toMatchObject({ created: 10, paid: 10, pickedUp: 10, failed: 0 });
      expect(report.sse.errors).toBe(0);
      expect(report.sseMissed).toBe(0);
      expect(report.api.some((e) => e.label === "POST /api/orders")).toBe(true);
    } finally {
      await stack.stop();
      for (let attempt = 0; attempt < 10; attempt++) {
        try {
          rmSync(dataDir, { recursive: true, force: true });
          break;
        } catch {
          Bun.gc(true);
          await Bun.sleep(100);
        }
      }
    }
  });
});
