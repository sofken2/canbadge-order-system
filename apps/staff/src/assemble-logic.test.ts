import { describe, expect, test } from "bun:test";
import type { StaffOrderView } from "@canbadge/shared";
import {
  formatWait,
  groupOrders,
  isCompleteCode,
  LONG_WAIT_MINUTES,
  minutesSince,
  normalizeConfirmationCode,
  notPickableMessage,
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
  });
});

describe("注文のまとめ方", () => {
  const items = [
    order(7, "ready", "2026-11-03T11:30:00Z"),
    order(3, "printed"),
    order(5, "assembling"),
    order(2, "printed"),
    order(9, "ready", "2026-11-03T11:10:00Z"),
    order(4, "assembling"),
    order(1, "picked_up"),
  ];

  test("組み立て待ち・組み立て中は番号順。受け取り待ちは、できあがりの古い順（長く待っている順）", () => {
    const grouped = groupOrders(items);
    expect(grouped.toAssemble.map((o) => o.orderNumber)).toEqual([2, 3]);
    expect(grouped.assembling.map((o) => o.orderNumber)).toEqual([4, 5]);
    expect(grouped.ready.map((o) => o.orderNumber)).toEqual([9, 7]);
  });

  test("対象の状態でない注文は、どこにも入らない。もとの配列は変えない", () => {
    const grouped = groupOrders(items);
    const count = grouped.toAssemble.length + grouped.assembling.length + grouped.ready.length;
    expect(count).toBe(6);
    expect(items[0]?.orderNumber).toBe(7);
  });
});

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

  test("4 文字そろったら、完成", () => {
    expect(isCompleteCode("K7Q")).toBe(false);
    expect(isCompleteCode("K7QH")).toBe(true);
  });
});

describe("受け渡しできない注文の説明", () => {
  test("受け渡せる状態には、説明がない", () => {
    expect(notPickableMessage("ready", "017")).toBe("");
  });

  test("できあがる前は、いまの状態と、してほしいことを伝える。支払い前は、レジへ", () => {
    expect(notPickableMessage("assembling", "017")).toContain("組み立て中");
    expect(notPickableMessage("printed", "017")).toContain("まだできあがっていません");
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
