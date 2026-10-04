import { describe, expect, test } from "bun:test";
import {
  CONFIRMATION_CODE_ALPHABET,
  confirmationCodeInputSchema,
  confirmationCodeSchema,
  formatOrderNumber,
  idSchema,
} from "./ids";
import { relativePathSchema } from "./primitives";

describe("確認コード", () => {
  test("紛らわしい文字（0 O 1 I L）を含まず、重複もない", () => {
    for (const ch of ["0", "O", "1", "I", "L"]) {
      expect(CONFIRMATION_CODE_ALPHABET).not.toContain(ch);
    }
    expect(new Set(CONFIRMATION_CODE_ALPHABET).size).toBe(CONFIRMATION_CODE_ALPHABET.length);
  });

  test("保存する形は、大文字 4 文字だけ", () => {
    expect(confirmationCodeSchema.safeParse("K7QH").success).toBe(true);
    for (const bad of ["k7qh", "K7Q", "K7QHH", "K7QO", "K7Q1", "K7QL"]) {
      expect(confirmationCodeSchema.safeParse(bad).success).toBe(false);
    }
  });

  test("入力は、前後の空白を除き、小文字も大文字として受け付ける", () => {
    expect(confirmationCodeInputSchema.parse(" k7qh ")).toBe("K7QH");
    expect(confirmationCodeInputSchema.safeParse("k70h").success).toBe(false);
  });
});

describe("注文番号の表示", () => {
  test("設定の桁数でゼロ埋めする", () => {
    expect(formatOrderNumber(7, 3)).toBe("007");
    expect(formatOrderNumber(42, 4)).toBe("0042");
  });

  test("桁があふれても切り捨てない", () => {
    expect(formatOrderNumber(1234, 3)).toBe("1234");
  });
});

describe("ID", () => {
  test("ULID だけを受け付ける", () => {
    expect(idSchema.safeParse("01HZX3V5Q8N4M6T2B9C7D1E0FA").success).toBe(true);
    expect(idSchema.safeParse("not-an-id").success).toBe(false);
    expect(idSchema.safeParse("123").success).toBe(false);
  });
});

describe("データ置き場からの相対パス", () => {
  test("相対パスを受け付ける", () => {
    expect(relativePathSchema.safeParse("images/01HZX3V5Q8N4M6T2B9C7D1E0FA.png").success).toBe(
      true,
    );
  });

  test("絶対パス・親ディレクトリ・バックスラッシュ・ドライブ名は断る", () => {
    for (const bad of ["/etc/passwd", "../x", "images/../x", "a\\b", "C:\\x", "C:x", ""]) {
      expect(relativePathSchema.safeParse(bad).success).toBe(false);
    }
  });
});
