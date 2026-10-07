import { describe, expect, test } from "bun:test";
import { setFlash, takeFlash } from "./flash";

function fakeStorage() {
  const map = new Map<string, string>();
  return {
    setItem: (k: string, v: string) => void map.set(k, v),
    getItem: (k: string) => map.get(k) ?? null,
    removeItem: (k: string) => void map.delete(k),
    map,
  };
}

describe("お知らせ（flash）", () => {
  test("保存したお知らせは、1 回だけ取り出せて、そのあと消える", () => {
    const storage = fakeStorage();
    setFlash({ tone: "error", text: "注文はできました" }, storage);
    expect(takeFlash(storage)).toEqual({ tone: "error", text: "注文はできました" });
    expect(takeFlash(storage)).toBeUndefined();
  });

  test("何もなければ undefined", () => {
    expect(takeFlash(fakeStorage())).toBeUndefined();
  });

  test("形が違う・壊れた値は、出さない（画面を壊さない）", () => {
    const storage = fakeStorage();
    storage.map.set("canbadge-flash", "壊れた値");
    expect(takeFlash(storage)).toBeUndefined();
    storage.map.set("canbadge-flash", JSON.stringify({ tone: "bad", text: "x" }));
    expect(takeFlash(storage)).toBeUndefined();
  });

  test("保存・読み出しで例外が出ても（ストレージが使えない）、画面は、止まらない", () => {
    const broken = {
      setItem: () => {
        throw new Error("使えません");
      },
      getItem: () => {
        throw new Error("使えません");
      },
      removeItem: () => undefined,
    };
    expect(() => setFlash({ tone: "info", text: "x" }, broken)).not.toThrow();
    expect(takeFlash(broken)).toBeUndefined();
  });
});
