import { describe, expect, test } from "bun:test";
import { kiraPatternLabel, readKiraPattern, saveKiraPattern } from "./kira-pattern";

function fakeStorage() {
  const map = new Map<string, string>();
  return {
    setItem: (k: string, v: string) => void map.set(k, v),
    getItem: (k: string) => map.get(k) ?? null,
    map,
  };
}

describe("キラフィルムの柄（注文に記録できるまでのつなぎ）", () => {
  test("注文ごとに残して読める。ほかの注文には出ない", () => {
    const storage = fakeStorage();
    saveKiraPattern("A", "aurora", storage);
    expect(readKiraPattern("A", storage)).toBe("aurora");
    expect(readKiraPattern("B", storage)).toBeUndefined();
    expect(kiraPatternLabel("aurora")).toBe("オーロラ");
  });

  test("知らない値・ストレージが使えないときは、出さない（画面を止めない）", () => {
    const storage = fakeStorage();
    storage.map.set("canbadge-kira-pattern:A", "rainbow");
    expect(readKiraPattern("A", storage)).toBeUndefined();
    const broken = {
      setItem: () => {
        throw new Error("blocked");
      },
      getItem: () => {
        throw new Error("blocked");
      },
    };
    expect(() => saveKiraPattern("A", "shards", broken)).not.toThrow();
    expect(readKiraPattern("A", broken)).toBeUndefined();
  });
});
