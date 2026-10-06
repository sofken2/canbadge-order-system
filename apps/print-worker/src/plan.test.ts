import { describe, expect, test } from "bun:test";
import { type Candidate, planSheet } from "./plan";

const NOW = Date.parse("2026-11-03T12:00:00Z");
const ago = (seconds: number) => new Date(NOW - seconds * 1000).toISOString();
const item = (id: string, quantity = 1, waitedSeconds = 0): Candidate => ({
  orderItemId: id,
  quantity,
  waitingSince: ago(waitedSeconds),
});
const plan = (candidates: Candidate[], capacity = 6, waitSeconds = 60) =>
  planSheet(candidates, { capacity, waitSeconds, nowMs: NOW });

describe("印刷するか、待つか", () => {
  test("候補がなければ、empty", () => {
    expect(plan([])).toEqual({ status: "empty" });
  });

  test("用紙 1 枚分（6 個）たまったら、待たずに、すぐ印刷する", () => {
    const six = ["a", "b", "c", "d", "e", "f"].map((id) => item(id));
    const result = plan(six);
    expect(result).toMatchObject({ status: "print", used: 6 });
    if (result.status === "print")
      expect(result.batch.map((b) => b.orderItemId)).toEqual(["a", "b", "c", "d", "e", "f"]);
  });

  test("6 個より多ければ、先頭の 6 個だけ（残りは次のシート）", () => {
    const eight = Array.from({ length: 8 }, (_, i) => item(`i${i}`));
    const result = plan(eight);
    expect(result.status === "print" && result.batch.map((b) => b.orderItemId)).toEqual([
      "i0",
      "i1",
      "i2",
      "i3",
      "i4",
      "i5",
    ]);
  });

  test("足りなくて、いちばん古いバッジも、まだ待ち時間に達していなければ、待つ", () => {
    const result = plan([item("a", 1, 10), item("b", 1, 5)]);
    expect(result).toMatchObject({ status: "waiting", used: 2, capacity: 6 });
    if (result.status === "waiting") expect(result.waitedSeconds).toBe(10);
  });

  test("足りなくても、いちばん古いバッジが待ち時間（60 秒）に達したら、その分で印刷する", () => {
    expect(plan([item("a", 1, 60), item("b", 1, 5)])).toMatchObject({ status: "print", used: 2 });
    expect(plan([item("a", 1, 59), item("b", 1, 5)]).status).toBe("waiting");
  });

  test("待ち時間は、載せるバッジのうち、いちばん古いもので数える（並びの先頭でなくても）", () => {
    // 再印刷が先頭（新しく待ち始めた）でも、後ろの古いバッジの待ち時間で、印刷される
    expect(plan([item("reprint", 1, 0), item("old", 1, 120)]).status).toBe("print");
  });

  test("待ち時間 0 なら、1 個でも、すぐ印刷する", () => {
    expect(plan([item("a")], 6, 0)).toMatchObject({ status: "print", used: 1 });
  });
});

describe("個数のあるバッジ", () => {
  test("個数の分だけ、枠を使う。copies に、並べる数が入る", () => {
    const result = plan([item("a", 2), item("b", 1), item("c", 3)]);
    expect(result).toMatchObject({ status: "print", used: 6 });
    if (result.status === "print") expect(result.copies).toEqual([2, 1, 3]);
  });

  test("残りの枠に収まらないバッジは、載せずに次のシートに回し、後ろの収まるバッジを載せる", () => {
    // 4 個使ったあとの残りは 2。3 個のバッジは収まらないので飛ばし、1 個の d を載せる
    const result = plan([item("a", 4), item("big", 3), item("d", 1), item("e", 1)]);
    expect(result.status === "print" && result.batch.map((b) => b.orderItemId)).toEqual([
      "a",
      "d",
      "e",
    ]);
    expect(result).toMatchObject({ used: 6 });
  });

  test("回されたバッジが、次のシートでは先頭になるので、いつまでも後回しにならない", () => {
    const first = plan([item("a", 4), item("big", 3), item("d", 1), item("e", 1)]);
    const loaded = new Set(first.status === "print" ? first.batch.map((b) => b.orderItemId) : []);
    const rest = [item("big", 3), item("f", 1)].filter((c) => !loaded.has(c.orderItemId));
    const second = plan(rest);
    expect(second.status === "print" || second.status === "waiting").toBe(true);
    // 先頭の big が、必ず含まれる（待ち時間に達していれば、すぐ印刷）
    const waited = plan([item("big", 3, 100), item("f", 1)]);
    expect(waited.status === "print" && waited.batch[0]?.orderItemId).toBe("big");
  });

  test("枠より多い個数のバッジは、どのシートにも載らないので、選ばない", () => {
    expect(plan([item("huge", 7)]).status).toBe("empty");
    const result = plan([item("huge", 7), item("a", 1, 100)]);
    expect(result.status === "print" && result.batch.map((b) => b.orderItemId)).toEqual(["a"]);
  });

  test("枠がちょうど埋まったら、待ち時間に関係なく、すぐ印刷する（個数で数える）", () => {
    expect(plan([item("a", 3), item("b", 3)])).toMatchObject({ status: "print", used: 6 });
  });
});
