import { describe, expect, test } from "bun:test";
import {
  distinctNumbers,
  isReprintableOrderStatus,
  type ReprintTarget,
  reprintImpact,
  reprintResultMessage,
  splitReprintable,
  toggled,
} from "./print-logic";

const target = (
  orderNumber: number,
  orderStatus: ReprintTarget["orderStatus"],
  id = `i${orderNumber}`,
): ReprintTarget => ({
  orderItemId: id,
  orderNumber,
  orderNumberText: String(orderNumber).padStart(3, "0"),
  orderStatus,
});

describe("再印刷できる状態", () => {
  test("組み立て中・完成だけ（受け渡し済み・取り消しなどは、できない）", () => {
    for (const status of ["assembling", "ready"] as const) {
      expect(isReprintableOrderStatus(status)).toBe(true);
    }
    for (const status of [
      "submitted",
      "paid",
      "picked_up",
      "expired",
      "cancelled",
      "refunded",
    ] as const) {
      expect(isReprintableOrderStatus(status)).toBe(false);
    }
  });

  test("対象を、できるものと、外すものに分ける", () => {
    const { reprintable, excluded } = splitReprintable([
      target(1, "ready"),
      target(2, "picked_up"),
      target(3, "assembling"),
      target(4, "refunded"),
    ]);
    expect(reprintable.map((t) => t.orderNumber)).toEqual([1, 3]);
    expect(excluded.map((t) => t.orderNumber)).toEqual([2, 4]);
  });
});

describe("選択", () => {
  test("選ぶ・外す。もとの集合は変えない", () => {
    const base = new Set(["a"]);
    const added = toggled(base, "b");
    expect([...added]).toEqual(["a", "b"]);
    expect([...toggled(added, "a")]).toEqual(["b"]);
    expect([...base]).toEqual(["a"]);
  });
});

describe("再印刷の影響の説明", () => {
  test("注文番号は、小さい順で、重複しない（1 つの注文に、複数のバッジがあっても）", () => {
    expect(
      distinctNumbers([
        target(12, "ready", "a"),
        target(3, "ready", "b"),
        target(12, "ready", "c"),
      ]),
    ).toEqual(["003", "012"]);
  });

  test("状態ごとに、影響を分ける。完成は、呼び出しモニターから消えることを、組み立て中は、作り直しを伝える", () => {
    const lines = reprintImpact([
      target(5, "ready"),
      target(7, "assembling"),
      target(2, "assembling"),
      target(9, "ready"),
    ]);
    expect(lines.map((line) => line.status)).toEqual(["assembling", "ready"]);
    expect(lines.find((line) => line.status === "ready")?.numbers).toEqual(["005", "009"]);
    expect(lines.find((line) => line.status === "ready")?.text).toContain("呼び出しモニター");
    expect(lines.find((line) => line.status === "assembling")?.text).toContain("作り直し");
    expect(lines.find((line) => line.status === "assembling")?.numbers).toEqual(["002", "007"]);
  });

  test("対象がなければ、説明もない", () => {
    expect(reprintImpact([])).toEqual([]);
  });
});

describe("結果のメッセージ", () => {
  test("戻した数と、すでに印刷待ちだった数を伝える", () => {
    expect(reprintResultMessage({ reprintedItemIds: ["a", "b"], skippedItemIds: [] })).toContain(
      "2 個を、印刷待ちに戻しました",
    );
    expect(reprintResultMessage({ reprintedItemIds: ["a"], skippedItemIds: ["b"] })).toContain(
      "すでに印刷待ちの 1 個",
    );
    expect(reprintResultMessage({ reprintedItemIds: [], skippedItemIds: ["b", "c"] })).toContain(
      "何も変えていません",
    );
  });
});

// ---- 印刷待ちの見える化 ----
import type { StaffOrderView } from "@canbadge/shared";
import {
  formatSeconds,
  queueBadgeCount,
  queueState,
  secondsUntilPrint,
  toQueueEntries,
  waitedSeconds,
} from "./print-logic";

const QID = "01HZX3V5Q8N4M6T2B9C7D1E0FA";
const orderOf = (
  number: number,
  overrides: Partial<StaffOrderView> = {},
  items: StaffOrderView["items"] = [
    {
      id: QID,
      quantity: 1,
      kiraQuantity: 0,
      magnetQuantity: 0,
      status: "queued",
      printCount: 0,
      thumbnailUrl: "/t",
    },
  ],
): StaffOrderView => ({
  id: QID,
  businessDate: "2026-11-03",
  orderNumber: number,
  orderNumberText: String(number).padStart(3, "0"),
  status: "paid",
  totalAmount: 300,
  createdAt: "2026-11-03T01:00:00.000Z",
  paidAt: "2026-11-03T01:00:00.000Z",
  items,
  ...overrides,
});
const T0 = Date.parse("2026-11-03T01:00:00.000Z");

describe("印刷待ちの一覧", () => {
  test("支払い済みで、印刷待ちの明細がある注文だけ。古い順（待たせている順）", () => {
    const entries = toQueueEntries([
      orderOf(2, { paidAt: "2026-11-03T01:00:30.000Z" }),
      orderOf(1, { paidAt: "2026-11-03T01:00:00.000Z" }),
      orderOf(3, { status: "assembling" }),
      orderOf(4, {}, [
        {
          id: QID,
          quantity: 1,
          kiraQuantity: 0,
          magnetQuantity: 0,
          status: "printing",
          printCount: 0,
          thumbnailUrl: "/t",
        },
      ]),
    ]);
    expect(entries.map((e) => e.orderNumberText)).toEqual(["001", "002"]);
    expect(queueBadgeCount(entries)).toBe(2);
  });

  test("印刷したことのある明細を含む注文は、再印刷として扱う。個数は、印刷待ちの明細の合計", () => {
    const [entry] = toQueueEntries([
      orderOf(1, {}, [
        {
          id: QID,
          quantity: 2,
          kiraQuantity: 0,
          magnetQuantity: 0,
          status: "queued",
          printCount: 1,
          thumbnailUrl: "/t",
        },
        {
          id: QID,
          quantity: 1,
          kiraQuantity: 0,
          magnetQuantity: 0,
          status: "printed",
          printCount: 1,
          thumbnailUrl: "/t",
        },
      ]),
    ]);
    expect(entry?.reprint).toBe(true);
    expect(entry?.badges).toBe(2);
  });
});

describe("あと何秒で、印刷されるか", () => {
  test("最も古い印刷待ちが、待ち時間に達するまで。達していれば 0", () => {
    const entries = toQueueEntries([
      orderOf(1),
      orderOf(2, { paidAt: "2026-11-03T01:00:50.000Z" }),
    ]);
    expect(secondsUntilPrint(entries, 120, T0 + 30_000)).toBe(90);
    expect(secondsUntilPrint(entries, 120, T0 + 120_000)).toBe(0);
    expect(secondsUntilPrint(entries, 120, T0 + 500_000)).toBe(0);
  });

  const reprintItem = (requeuedAt: string | undefined): StaffOrderView["items"][number] => ({
    id: QID,
    quantity: 1,
    kiraQuantity: 0,
    magnetQuantity: 0,
    status: "queued",
    printCount: 1,
    requeuedAt,
    thumbnailUrl: "/t",
  });

  test("再印刷は、印刷待ちに戻ってから、待ち時間の半分（120 秒なら 60 秒）で印刷される", () => {
    // 支払いは、ずっと前（T0）。印刷待ちに戻ったのは、T0 + 10 分
    const entries = toQueueEntries([orderOf(1, {}, [reprintItem("2026-11-03T01:10:00.000Z")])]);
    const back = T0 + 600_000;
    expect(secondsUntilPrint(entries, 120, back)).toBe(60);
    expect(secondsUntilPrint(entries, 120, back + 45_000)).toBe(15);
    expect(secondsUntilPrint(entries, 120, back + 60_000)).toBe(0);
    expect(secondsUntilPrint(entries, 120, back + 500_000)).toBe(0);
  });

  test("ふつうのバッジと再印刷があれば、早く達するほうまで", () => {
    // ふつう：T0 + 100 秒に支払い → 達するのは T0 + 220 秒。再印刷：T0 + 150 秒に戻る → 達するのは T0 + 210 秒
    const entries = toQueueEntries([
      orderOf(1, { paidAt: "2026-11-03T01:01:40.000Z" }),
      orderOf(2, {}, [reprintItem("2026-11-03T01:02:30.000Z")]),
    ]);
    expect(secondsUntilPrint(entries, 120, T0 + 150_000)).toBe(60);
    // 再印刷のほうが遅く戻れば、ふつうのバッジが先に達する
    const later = toQueueEntries([
      orderOf(1, { paidAt: "2026-11-03T01:01:40.000Z" }),
      orderOf(2, {}, [reprintItem("2026-11-03T01:03:00.000Z")]),
    ]);
    expect(secondsUntilPrint(later, 120, T0 + 150_000)).toBe(70);
  });

  test("再印刷が複数の明細なら、いちばん古く戻った時刻から数える", () => {
    const [entry] = toQueueEntries([
      orderOf(1, {}, [
        reprintItem("2026-11-03T01:02:00.000Z"),
        reprintItem("2026-11-03T01:01:00.000Z"),
      ]),
    ]);
    expect(entry?.requeuedAt).toBe("2026-11-03T01:01:00.000Z");
  });

  test("起点の時刻が分からない再印刷（古いデータ）と、空の一覧は undefined", () => {
    const entries = toQueueEntries([orderOf(1, {}, [reprintItem(undefined)])]);
    expect(secondsUntilPrint(entries, 120, T0)).toBeUndefined();
    expect(secondsUntilPrint([], 120, T0)).toBeUndefined();
  });

  test("秒の表示と、待ち時間", () => {
    expect(formatSeconds(5)).toBe("5 秒");
    expect(formatSeconds(60)).toBe("1 分");
    expect(formatSeconds(65)).toBe("1 分 5 秒");
    expect(formatSeconds(3599)).toBe("59 分 59 秒");
    // 1 時間をこえたら、秒は出さず、時間と分にする
    expect(formatSeconds(3600)).toBe("1 時間");
    expect(formatSeconds(1235 * 60 + 7)).toBe("20 時間 35 分");
    expect(waitedSeconds("2026-11-03T01:00:00.000Z", T0 + 75_000)).toBe(75);
    expect(waitedSeconds(undefined, T0)).toBeUndefined();
    expect(waitedSeconds("ふつうの文字", T0)).toBeUndefined();
  });
});

describe("印刷待ちの説明", () => {
  const base = { badges: 2, capacity: 6, paused: false, printing: false, secondsLeft: 45 };

  test("待ち時間で印刷されるとき：あと何個で 1 枚分か、あと何秒で、いまある分を印刷するか", () => {
    const state = queueState(base);
    expect(state.headline).toBe("印刷待ち 2 個");
    expect(state.detail).toContain("あと 4 個で用紙 1 枚分");
    expect(state.detail).toContain("あと 45 秒で、いまある分を印刷します");
    expect(state.needsAction).toBe(false);
  });

  test("用紙 1 枚分たまっているとき", () => {
    expect(queueState({ ...base, badges: 6 }).detail).toContain(
      "用紙 1 枚分（6 個）たまっています",
    );
  });

  test("印刷中のシートがあるときは、終わると次を印刷すると伝える（印刷係は、何もしなくてよい）", () => {
    const state = queueState({ ...base, printing: true });
    expect(state.detail).toContain("終わると、次のシートを印刷します");
    expect(state.needsAction).toBe(false);
  });

  test("止めているときは、再開を促す。何もないときは、その旨", () => {
    expect(queueState({ ...base, paused: true }).detail).toContain("印刷を再開する");
    expect(queueState({ ...base, paused: true }).needsAction).toBe(true);
    expect(queueState({ ...base, badges: 0 }).headline).toBe("印刷待ちはありません");
    expect(queueState({ ...base, badges: 0, printing: true }).detail).toContain("自動で組み立て中");
  });

  test("再印刷だけのとき・待ち時間に達したとき", () => {
    expect(queueState({ ...base, secondsLeft: undefined }).detail).toContain(
      "再印刷のバッジが、先に",
    );
    expect(queueState({ ...base, secondsLeft: 0 }).detail).toContain("まもなく");
  });
});
