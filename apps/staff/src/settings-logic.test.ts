import { describe, expect, test } from "bun:test";
import type { SalesResponse, Setting } from "@canbadge/shared";
import {
  barRatio,
  closeImpact,
  formChanged,
  formFromSetting,
  hourlyRows,
  openDayImpact,
  parseInteger,
  parseSettingsForm,
  todayJst,
} from "./settings-logic";

const setting: Setting = {
  businessDate: "2026-11-03",
  acceptance: "open",
  busyMessage: null,
  price: 300,
  kiraFilmPrice: 100,
  maxQuantityPerOrder: 1,
  maxPendingPerDevice: 2,
  printMaxWaitSeconds: 60,
  printPaused: false,
  orderNumberDigits: 3,
  imageMaxBytes: 10 * 1024 * 1024,
  updatedAt: "2026-11-03T00:00:00.000Z",
};

describe("今日（日本時間）", () => {
  test("UTC の夜は、日本では翌日", () => {
    expect(todayJst(Date.parse("2026-11-03T14:59:59Z"))).toBe("2026-11-03");
    expect(todayJst(Date.parse("2026-11-03T15:00:00Z"))).toBe("2026-11-04");
  });
});

describe("営業開始の影響", () => {
  test("営業日が変わるとき：注文番号は 1 から。支払い待ちは期限切れ。取り消せない", () => {
    const impact = openDayImpact({
      businessDate: "2026-11-02",
      today: "2026-11-03",
      submittedCount: 4,
    });
    const text = impact.lines.join("\n");
    expect(text).toContain("1 番から");
    expect(text).toContain("4 件は、期限切れ");
    expect(text).toContain("取り消せません");
  });

  test("初めての営業開始（営業日がまだない）も、新しい営業日として扱う", () => {
    const impact = openDayImpact({ businessDate: null, today: "2026-11-03", submittedCount: 0 });
    expect(impact.lines.join("\n")).toContain("1 番から");
    expect(impact.lines.join("\n")).not.toContain("期限切れ");
  });

  test("同じ日に、もう一度押したとき：受付を戻すだけ。注文番号は続き。支払い待ちはそのまま", () => {
    const impact = openDayImpact({
      businessDate: "2026-11-03",
      today: "2026-11-03",
      submittedCount: 5,
    });
    const text = impact.lines.join("\n");
    expect(impact.title).toContain("再開");
    expect(text).toContain("続きから");
    expect(text).not.toContain("期限切れ");
  });
});

describe("受付終了の影響", () => {
  test("支払い待ちがあれば件数を伝え、レジで済ませてから押すよう促す。取り消せない", () => {
    const text = closeImpact(3).lines.join("\n");
    expect(text).toContain("3 件は、期限切れ");
    expect(text).toContain("レジ");
    expect(text).toContain("取り消せません");
  });

  test("支払い待ちがなければ、期限切れの話は出ない", () => {
    expect(closeImpact(0).lines.join("\n")).not.toContain("期限切れ");
  });
});

describe("設定の入力", () => {
  test("保存済みの値から、入力欄の文字を作る（容量は MB）", () => {
    expect(formFromSetting(setting)).toEqual({
      price: "300",
      kiraFilmPrice: "100",
      maxQuantityPerOrder: "1",
      maxPendingPerDevice: "2",
      printMaxWaitSeconds: "60",
      orderNumberDigits: "3",
      imageMaxMb: "10",
    });
  });

  test("数字の読み取り：全角・カンマ・空白を許す。数字以外・空は、受けない", () => {
    expect(parseInteger("３００")).toBe(300);
    expect(parseInteger(" 1,000 ")).toBe(1000);
    expect(parseInteger("")).toBeUndefined();
    expect(parseInteger("12a")).toBeUndefined();
    expect(parseInteger("-1")).toBeUndefined();
    expect(parseInteger("1.5")).toBeUndefined();
  });

  test("正しい入力は、api に送る値になる（MB はバイトに）", () => {
    const parsed = parseSettingsForm({
      ...formFromSetting(setting),
      price: "350",
      imageMaxMb: "2.5",
    });
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.value.price).toBe(350);
      expect(parsed.value.imageMaxBytes).toBe(2.5 * 1024 * 1024);
    }
  });

  test("数字でない入力は、その欄のエラーにする（ほかの欄は、そのまま）", () => {
    const parsed = parseSettingsForm({ ...formFromSetting(setting), price: "abc" });
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) {
      expect(Object.keys(parsed.errors)).toEqual(["price"]);
      expect(parsed.errors.price).toContain("価格");
    }
  });

  test("契約の範囲：上限・待ち秒数は 1 以上、桁数は 1〜6", () => {
    const zero = parseSettingsForm({ ...formFromSetting(setting), maxQuantityPerOrder: "0" });
    expect(zero.ok).toBe(false);
    const digits = parseSettingsForm({ ...formFromSetting(setting), orderNumberDigits: "7" });
    expect(digits.ok).toBe(false);
    if (!digits.ok) expect(digits.errors.orderNumberDigits).toContain("1〜6");
  });

  test("容量は 0 以下・数でない・大きすぎる値を受けない", () => {
    for (const value of ["0", "-1", "abc", "", "5000"]) {
      expect(parseSettingsForm({ ...formFromSetting(setting), imageMaxMb: value }).ok).toBe(false);
    }
  });

  test("変更の有無：保存済みと同じなら、変更なし（前後の空白は無視）", () => {
    const form = formFromSetting(setting);
    expect(formChanged(form, setting)).toBe(false);
    expect(formChanged({ ...form, price: " 300 " }, setting)).toBe(false);
    expect(formChanged({ ...form, price: "310" }, setting)).toBe(true);
  });
});

describe("売上", () => {
  const sales: SalesResponse = {
    businessDate: "2026-11-03",
    hourly: [
      { hour: 11, paidCount: 4, paidAmount: 1200 },
      { hour: 10, paidCount: 2, paidAmount: 600 },
      { hour: 13, paidCount: 0, paidAmount: 0 },
    ],
    total: {
      paidCount: 6,
      paidAmount: 1800,
      refundedCount: 1,
      refundedAmount: 300,
      netAmount: 1500,
    },
  };

  test("時間帯は早い順。棒の長さは、最大の時間帯を 1 とする", () => {
    const { rows, max } = hourlyRows(sales);
    expect(rows.map((row) => row.hour)).toEqual([10, 11, 13]);
    expect(max).toBe(1200);
    expect(rows.map((row) => row.ratio)).toEqual([0.5, 1, 0]);
  });

  test("売上がまったくなくても、割り算で壊れない", () => {
    expect(barRatio(0, 0)).toBe(0);
    expect(hourlyRows({ ...sales, hourly: [] }).rows).toEqual([]);
  });

  test("元の配列は、並べ替えない", () => {
    hourlyRows(sales);
    expect(sales.hourly[0]?.hour).toBe(11);
  });
});
