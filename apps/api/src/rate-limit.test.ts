import { describe, expect, test } from "bun:test";
import { waitText } from "./abuse";
import { createRateLimiter } from "./rate-limit";

function setup(limit = 3, windowMs = 60_000) {
  let now = 1_000_000;
  const limiter = createRateLimiter({ limit, windowMs, now: () => now });
  return { limiter, advance: (ms: number) => (now += ms) };
}

describe("回数の制限", () => {
  test("上限までは通り、超えたら、あと何秒かを返す", () => {
    const { limiter, advance } = setup();
    expect(limiter.hit("a").allowed).toBe(true);
    advance(10_000);
    expect(limiter.hit("a").allowed).toBe(true);
    advance(10_000);
    expect(limiter.hit("a").allowed).toBe(true);
    advance(10_000);
    const blocked = limiter.hit("a");
    expect(blocked).toEqual({ allowed: false, retryAfterSeconds: 30 });
  });

  test("相手（key）ごとに数える", () => {
    const { limiter } = setup(1);
    expect(limiter.hit("a").allowed).toBe(true);
    expect(limiter.hit("a").allowed).toBe(false);
    expect(limiter.hit("b").allowed).toBe(true);
  });

  test("窓をずらして数える：いちばん古い 1 回が窓から出ると、1 回分だけ空く", () => {
    const { limiter, advance } = setup(2, 60_000);
    limiter.hit("a");
    advance(30_000);
    limiter.hit("a");
    expect(limiter.hit("a").allowed).toBe(false);
    advance(30_001);
    expect(limiter.hit("a").allowed).toBe(true);
    expect(limiter.hit("a").allowed).toBe(false);
  });

  test("断られた回は、数えない（待っている間に連打しても、待ち時間が延びない）", () => {
    const { limiter, advance } = setup(1, 60_000);
    limiter.hit("a");
    for (let i = 0; i < 50; i++) limiter.hit("a");
    advance(60_001);
    expect(limiter.hit("a").allowed).toBe(true);
  });

  test("peek は、記録を増やさずに、いま通れるかを答える", () => {
    const { limiter } = setup(2);
    expect(limiter.peek("a").allowed).toBe(true);
    limiter.hit("a");
    limiter.hit("a");
    expect(limiter.peek("a").allowed).toBe(false);
    expect(limiter.peek("a").allowed).toBe(false);
    expect(limiter.peek("zzz").allowed).toBe(true);
  });

  test("reset で、その相手の記録を消せる", () => {
    const { limiter } = setup(1);
    limiter.hit("a");
    limiter.reset("a");
    expect(limiter.hit("a").allowed).toBe(true);
  });

  test("古い記録は掃除され、相手の数が増え続けない", () => {
    const { limiter, advance } = setup(1, 1000);
    for (let i = 0; i < 100; i++) limiter.hit(`ip-${i}`);
    expect(limiter.size()).toBe(100);
    advance(5000);
    limiter.hit("new");
    expect(limiter.size()).toBe(1);
  });

  test("待ち時間の言い方", () => {
    expect(waitText(45)).toBe("45 秒");
    expect(waitText(60)).toBe("1 分");
    expect(waitText(90)).toBe("1 分 30 秒");
  });
});
