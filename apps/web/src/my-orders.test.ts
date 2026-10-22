import { describe, expect, test } from "bun:test";
import { forgetOrders, MAX_REMEMBERED_ORDERS, rememberedOrders, rememberOrder } from "./my-orders";

function fakeStorage() {
  const map = new Map<string, string>();
  return {
    setItem: (k: string, v: string) => void map.set(k, v),
    getItem: (k: string) => map.get(k) ?? null,
    map,
  };
}

describe("この端末の注文", () => {
  test("新しい順に覚え、同じ注文は 1 つにまとめる", () => {
    const storage = fakeStorage();
    rememberOrder("A", storage);
    rememberOrder("B", storage);
    rememberOrder("A", storage);
    expect(rememberedOrders(storage)).toEqual(["A", "B"]);
  });

  test("覚えるのは、新しいものから決まった件数まで", () => {
    const storage = fakeStorage();
    for (let i = 0; i < MAX_REMEMBERED_ORDERS + 5; i++) rememberOrder(`O${i}`, storage);
    const ids = rememberedOrders(storage);
    expect(ids).toHaveLength(MAX_REMEMBERED_ORDERS);
    expect(ids[0]).toBe(`O${MAX_REMEMBERED_ORDERS + 4}`);
  });

  test("開けなくなった注文は忘れる。壊れた中身は、空として扱う", () => {
    const storage = fakeStorage();
    rememberOrder("A", storage);
    rememberOrder("B", storage);
    forgetOrders(["A"], storage);
    expect(rememberedOrders(storage)).toEqual(["B"]);
    storage.setItem("canbadge-my-orders", "{broken");
    expect(rememberedOrders(storage)).toEqual([]);
  });
});
