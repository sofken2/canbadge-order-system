import { describe, expect, test } from "bun:test";
import { confirmationCodeSchema, idSchema } from "@canbadge/shared";
import { generateConfirmationCode, newId } from "./generate";

describe("確認コードの採番", () => {
  test("作ったコードは、すべて契約の形式に合う", () => {
    for (let i = 0; i < 2000; i++) {
      expect(confirmationCodeSchema.safeParse(generateConfirmationCode()).success).toBe(true);
    }
  });

  test("乱数のバイトから、決まった文字を選ぶ", () => {
    const bytes = [0, 1, 2, 3];
    expect(generateConfirmationCode(() => bytes.shift() ?? 0)).toBe("2345");
  });

  test("偏りを避けるため、248 以上のバイトは捨てて引き直す", () => {
    const bytes = [255, 248, 250, 0, 1, 2, 3];
    expect(generateConfirmationCode(() => bytes.shift() ?? 0)).toBe("2345");
  });
});

describe("ID の採番", () => {
  test("ULID の形式で、同じミリ秒でも作った順に並ぶ", () => {
    const at = new Date("2026-11-03T00:00:00Z");
    const ids = Array.from({ length: 100 }, () => newId(at));
    for (const id of ids) expect(idSchema.safeParse(id).success).toBe(true);
    expect([...ids].sort()).toEqual(ids);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test("時刻を渡すと、その時刻順に並ぶ", () => {
    const a = newId(new Date("2026-11-03T00:00:00Z"));
    const b = newId(new Date("2026-11-03T00:00:01Z"));
    expect(a < b).toBe(true);
  });
});
