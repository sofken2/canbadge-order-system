import { describe, expect, test } from "bun:test";
import { lookupErrorMessage, parseLookupInput, parseOrderNumber } from "./lookup-logic";

describe("注文番号の入力", () => {
  test("数字（全角・前後の空白も可）を、整数にする。先頭の 0 は、そのまま数になる", () => {
    expect(parseOrderNumber("17")).toBe(17);
    expect(parseOrderNumber("017")).toBe(17);
    expect(parseOrderNumber(" １７ ")).toBe(17);
    expect(parseOrderNumber("123456")).toBe(123456);
  });

  test("空・0・数字以外・7 桁以上・小数・負の数は、受けない", () => {
    for (const raw of ["", "  ", "0", "000", "abc", "1a", "1234567", "1.5", "-3", "#17"]) {
      expect(parseOrderNumber(raw)).toBeUndefined();
    }
  });
});

describe("照会の入力", () => {
  test("注文番号と、4 文字の確認コードがそろえば、送れる形になる", () => {
    expect(parseLookupInput("017", "K7QH")).toEqual({
      ok: true,
      orderNumber: 17,
      confirmationCode: "K7QH",
    });
  });

  test("足りない欄は、その欄に、してほしいことを添える（両方足りなければ、両方）", () => {
    const empty = parseLookupInput("", "");
    expect(empty.ok).toBe(false);
    if (!empty.ok) {
      expect(empty.errors.orderNumber).toContain("入れてください");
      expect(empty.errors.confirmationCode).toContain("入れてください");
    }
    const short = parseLookupInput("17", "K7Q");
    expect(short.ok).toBe(false);
    if (!short.ok) {
      expect(short.errors.orderNumber).toBeUndefined();
      expect(short.errors.confirmationCode).toContain("4 文字");
    }
    const badNumber = parseLookupInput("abc", "K7QH");
    expect(badNumber.ok).toBe(false);
    if (!badNumber.ok) expect(badNumber.errors.orderNumber).toContain("数字");
  });
});

describe("失敗したときの文", () => {
  test("見つからないときは、番号と確認コードのどちらが違うかを、教えない", () => {
    const text = lookupErrorMessage({ code: "NOT_FOUND", message: "注文が見つかりません" });
    expect(text).toContain("注文番号と確認コード");
    expect(text).not.toContain("確認コードが違");
    expect(text).not.toContain("番号が違");
    expect(text).toContain("今日");
  });

  test("回数の制限では、api の文（待つ時間つき）を、そのまま出す", () => {
    const message =
      "確認コードを、何度も間違えています。4 分 58 秒ほど待ってから、もう一度お試しください";
    expect(lookupErrorMessage({ code: "RATE_LIMITED", message })).toBe(message);
  });

  test("つながらない・入力の誤り・想定外は、してほしいことを添える", () => {
    expect(lookupErrorMessage({ code: "NETWORK", message: "x" })).toContain("電波");
    expect(lookupErrorMessage({ code: "VALIDATION_FAILED", message: "x" })).toContain("確かめて");
    const other = lookupErrorMessage({ code: "INTERNAL", message: "内部のエラー" });
    expect(other).toContain("スタッフ");
    expect(other).not.toContain("内部のエラー");
  });
});
