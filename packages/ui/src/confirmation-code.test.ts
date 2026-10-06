import { describe, expect, test } from "bun:test";
import { isCompleteCode, normalizeConfirmationCode } from "./confirmation-code";

describe("確認コードの入力", () => {
  test("小文字・全角・空白を整え、4 文字で切る", () => {
    expect(normalizeConfirmationCode("k7qh")).toBe("K7QH");
    expect(normalizeConfirmationCode(" ｋ７ｑｈ ")).toBe("K7QH");
    expect(normalizeConfirmationCode("K7QH9")).toBe("K7QH");
  });

  test("使わない文字（0 O 1 I L）と記号は、捨てる", () => {
    expect(normalizeConfirmationCode("K0O7-1IQ")).toBe("K7Q");
    expect(normalizeConfirmationCode("L")).toBe("");
  });

  test("貼り付けた文字列（前後の空白・改行）も、整えて入る", () => {
    expect(normalizeConfirmationCode("\n k7-qh \n")).toBe("K7QH");
  });

  test("4 文字そろったら、完成", () => {
    expect(isCompleteCode("K7Q")).toBe(false);
    expect(isCompleteCode("K7QH")).toBe(true);
  });
});
