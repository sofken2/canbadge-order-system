import { describe, expect, test } from "bun:test";
import type { StaffOrderView } from "@canbadge/shared";
import {
  formatWait,
  groupOrders,
  LONG_WAIT_MINUTES,
  minutesSince,
  notPickableMessage,
  readySinceLabel,
  urgencyOf,
  VERY_LONG_WAIT_MINUTES,
} from "./assemble-logic";

const order = (
  orderNumber: number,
  status: StaffOrderView["status"],
  readyAt?: string,
): StaffOrderView =>
  ({
    id: `id${orderNumber}`,
    orderNumber,
    orderNumberText: String(orderNumber).padStart(3, "0"),
    status,
    readyAt,
    items: [],
  }) as unknown as StaffOrderView;

describe("長く待っているか", () => {
  const now = Date.parse("2026-11-03T12:00:00Z");

  test("経過分は切り捨て。時刻がなければ undefined、未来は 0", () => {
    expect(minutesSince("2026-11-03T11:50:30Z", now)).toBe(9);
    expect(minutesSince("2026-11-03T12:00:00Z", now)).toBe(0);
    expect(minutesSince("2026-11-03T12:05:00Z", now)).toBe(0);
    expect(minutesSince(undefined, now)).toBeUndefined();
    expect(minutesSince("not a date", now)).toBeUndefined();
  });

  test("しきい値：10 分で注意、20 分で強く。それ未満は、通常", () => {
    expect(urgencyOf(LONG_WAIT_MINUTES - 1)).toBe("normal");
    expect(urgencyOf(LONG_WAIT_MINUTES)).toBe("long");
    expect(urgencyOf(VERY_LONG_WAIT_MINUTES - 1)).toBe("long");
    expect(urgencyOf(VERY_LONG_WAIT_MINUTES)).toBe("very-long");
    expect(urgencyOf(undefined)).toBe("normal");
  });

  test("経過時間の読みやすい表示", () => {
    expect(formatWait(0)).toBe("0 分");
    expect(formatWait(59)).toBe("59 分");
    expect(formatWait(60)).toBe("1 時間");
    expect(formatWait(65)).toBe("1 時間 5 分");
    // 見出しと同じ、契約の「受け取り可能」の言葉で書く
    expect(readySinceLabel(12)).toBe("受け取り可能になって 12 分");
  });
});

describe("注文のまとめ方", () => {
  const items = [
    order(7, "ready", "2026-11-03T11:30:00Z"),
    order(3, "assembling"),
    order(5, "assembling"),
    order(2, "assembling"),
    order(9, "ready", "2026-11-03T11:10:00Z"),
    order(4, "assembling"),
    order(1, "picked_up"),
  ];

  test("組み立て中は番号順。受け取り待ちは、できあがりの古い順（長く待っている順）", () => {
    const grouped = groupOrders(items);
    expect(grouped.assembling.map((o) => o.orderNumber)).toEqual([2, 3, 4, 5]);
    expect(grouped.ready.map((o) => o.orderNumber)).toEqual([9, 7]);
  });

  test("対象の状態でない注文は、どこにも入らない。もとの配列は変えない", () => {
    const grouped = groupOrders(items);
    const count = grouped.assembling.length + grouped.ready.length;
    expect(count).toBe(6);
    expect(items[0]?.orderNumber).toBe(7);
  });
});

describe("受け渡しできない注文の説明", () => {
  test("受け渡せる状態には、説明がない", () => {
    expect(notPickableMessage("ready", "017")).toBe("");
  });

  test("できあがる前は、いまの状態と、してほしいことを伝える。支払い前は、レジへ", () => {
    expect(notPickableMessage("assembling", "017")).toContain("組み立て中");
    expect(notPickableMessage("paid", "017")).toContain("まだできあがっていません");
    expect(notPickableMessage("submitted", "017")).toContain("レジ");
  });

  test("受け渡し済み・取り消しなどにも、理由を伝える。叫ばない", () => {
    expect(notPickableMessage("picked_up", "017")).toContain("すでに受け渡し済み");
    for (const status of ["cancelled", "expired", "refunded"] as const) {
      const message = notPickableMessage(status, "017");
      expect(message).toContain("受け渡しできません");
      expect(message).not.toContain("！");
    }
  });
});
