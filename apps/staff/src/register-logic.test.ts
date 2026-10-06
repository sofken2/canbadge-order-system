import { describe, expect, test } from "bun:test";
import {
  changeFor,
  notPayableMessage,
  parseRegisterInput,
  receivedChoices,
  secondsLeft,
} from "./register-logic";

describe("入力の判定", () => {
  const id = "01M4886AJW3N2PNETJY96MXERK";

  test("注文 ID の形なら ID。小文字・前後の空白があっても、読める", () => {
    expect(parseRegisterInput(id)).toEqual({ kind: "order-id", value: id });
    expect(parseRegisterInput(`  ${id.toLowerCase()}\n`)).toEqual({ kind: "order-id", value: id });
  });

  test("数字だけなら注文番号。全角の数字も、半角として読む", () => {
    expect(parseRegisterInput("17")).toEqual({ kind: "number", value: "17" });
    expect(parseRegisterInput("017")).toEqual({ kind: "number", value: "017" });
    expect(parseRegisterInput("０１７")).toEqual({ kind: "number", value: "017" });
  });

  test("空・どれでもない文字は、それぞれ別の扱い（探しに行かない）", () => {
    expect(parseRegisterInput("   ")).toEqual({ kind: "empty" });
    expect(parseRegisterInput("")).toEqual({ kind: "empty" });
    expect(parseRegisterInput("abc")).toEqual({ kind: "invalid", text: "abc" });
    // 長すぎる数字・別の QR（URL など）
    expect(parseRegisterInput("1234567").kind).toBe("invalid");
    expect(parseRegisterInput("https://example.com/").kind).toBe("invalid");
  });
});

describe("お釣り", () => {
  test("受け取り額から、金額を引く。ちょうどなら 0", () => {
    expect(changeFor(300, 1000)).toEqual({ change: 700, short: 0 });
    expect(changeFor(300, 300)).toEqual({ change: 0, short: 0 });
  });

  test("足りないときは、不足の額が出て、お釣りは 0（マイナスにしない）", () => {
    expect(changeFor(300, 200)).toEqual({ change: 0, short: 100 });
  });

  test("金額は円の整数のまま（小数を使わない）", () => {
    for (const [total, received] of [
      [300, 1000],
      [600, 1000],
      [900, 10000],
    ] as const) {
      const { change } = changeFor(total, received);
      expect(Number.isInteger(change)).toBe(true);
    }
  });
});

describe("受け取り額のボタン", () => {
  test("金額より大きい、いちばん近いお札から 3 つ", () => {
    expect(receivedChoices(300)).toEqual([1000, 2000, 5000]);
    expect(receivedChoices(1500)).toEqual([2000, 5000, 10000]);
    expect(receivedChoices(900)).toEqual([1000, 2000, 5000]);
  });

  test("金額が大きいときは、残りのお札だけ。越えるお札がなければ、空", () => {
    expect(receivedChoices(6000)).toEqual([10000]);
    expect(receivedChoices(10000)).toEqual([]);
  });
});

describe("支払いを受けられない注文の説明", () => {
  test("支払い済み以降は『すでに支払い済み』と、いまの状態を伝える", () => {
    for (const status of ["paid", "printed", "assembling", "ready", "picked_up"] as const) {
      const message = notPayableMessage(status, "017");
      expect(message).toContain("017");
      expect(message).toContain("すでに支払い済み");
    }
    expect(notPayableMessage("paid", "017")).toContain("印刷待ち");
  });

  test("取り消し・期限切れ・返金は、受けられない理由と、してほしいことを伝える。叫ばない", () => {
    for (const status of ["cancelled", "expired", "refunded"] as const) {
      const message = notPayableMessage(status, "017");
      expect(message).toContain("支払いを受けられません");
      expect(message).not.toContain("！");
    }
  });

  test("支払い待ちには、説明がない（そのまま進む）", () => {
    expect(notPayableMessage("submitted", "017")).toBe("");
  });
});

describe("取り消せる残り時間", () => {
  test("秒の切り上げ。過ぎたら 0", () => {
    expect(secondsLeft(5000, 0)).toBe(5);
    expect(secondsLeft(5000, 4001)).toBe(1);
    expect(secondsLeft(5000, 5000)).toBe(0);
    expect(secondsLeft(5000, 9000)).toBe(0);
  });
});
