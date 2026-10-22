import { describe, expect, test } from "bun:test";
import type { MonitorReadyItem } from "@canbadge/shared";
import { densityFor, newlyReady, siteUrlFrom, sortReady } from "./monitor-logic";

const item = (orderNumber: number, readyAt: string): MonitorReadyItem => ({
  orderNumber,
  orderNumberText: String(orderNumber).padStart(3, "0"),
  readyAt,
});

describe("並び順", () => {
  test("できあがりの古い順。同じ時刻なら番号順。もとの配列は変えない", () => {
    const items = [
      item(7, "2026-11-03T10:05:00Z"),
      item(3, "2026-11-03T10:10:00Z"),
      item(5, "2026-11-03T10:05:00Z"),
    ];
    expect(sortReady(items).map((i) => i.orderNumber)).toEqual([5, 7, 3]);
    expect(items[0]?.orderNumber).toBe(7);
  });
});

describe("密度", () => {
  test("番号が増えるほど、密になる（境目）", () => {
    expect(densityFor(0)).toBe("solo");
    expect(densityFor(2)).toBe("solo");
    expect(densityFor(3)).toBe("few");
    expect(densityFor(4)).toBe("few");
    expect(densityFor(5)).toBe("some");
    expect(densityFor(9)).toBe("some");
    expect(densityFor(10)).toBe("many");
    expect(densityFor(20)).toBe("many");
    expect(densityFor(21)).toBe("crowded");
  });
});

describe("新しくできあがった番号", () => {
  const items = [item(1, "a"), item(2, "b"), item(3, "c")];

  test("最初の表示では、どれも新しいとしない（画面を開いただけで、全部が光らないように）", () => {
    expect(newlyReady(undefined, items).size).toBe(0);
  });

  test("前の表示になかった番号だけが、新しい", () => {
    expect([...newlyReady(new Set([1, 2]), items)]).toEqual([3]);
    expect(newlyReady(new Set([1, 2, 3]), items).size).toBe(0);
  });
});

describe("固定 QR の URL", () => {
  test("http・https だけを使う。空・不正・別の方式は、使わない", () => {
    expect(siteUrlFrom("https://badge.example.com/")).toBe("https://badge.example.com/");
    expect(siteUrlFrom(" https://badge.example.com ")).toBe("https://badge.example.com/");
    expect(siteUrlFrom("http://localhost:3000")).toBe("http://localhost:3000/");
    expect(siteUrlFrom("")).toBeUndefined();
    expect(siteUrlFrom(undefined)).toBeUndefined();
    expect(siteUrlFrom("badge.example.com")).toBeUndefined();
    expect(siteUrlFrom("javascript:alert(1)")).toBeUndefined();
  });
});
