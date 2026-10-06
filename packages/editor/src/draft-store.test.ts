import { describe, expect, test } from "bun:test";
import { DRAFT_MAX_AGE_MS, isDraftFresh } from "./draft-store";

describe("途中保存の有効期間", () => {
  const now = Date.parse("2026-11-03T12:00:00+09:00");

  test("24 時間以内は、続きから再開できる。それより古いものは、使わない", () => {
    expect(isDraftFresh(now - 60_000, now)).toBe(true);
    expect(isDraftFresh(now - DRAFT_MAX_AGE_MS, now)).toBe(true);
    expect(isDraftFresh(now - DRAFT_MAX_AGE_MS - 1, now)).toBe(false);
  });

  test("端末の時計が少し進んでいても（1 分まで）使える。大きく未来のものは、使わない", () => {
    expect(isDraftFresh(now + 30_000, now)).toBe(true);
    expect(isDraftFresh(now + 61_000, now)).toBe(false);
  });
});
