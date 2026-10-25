import { describe, expect, test } from "bun:test";
import {
  actorSchema,
  archiveStatusSchema,
  orderItemStatusSchema,
  orderStatusSchema,
  printSheetStatusSchema,
} from "./status";
import {
  archiveTransitions,
  orderItemTransitions,
  orderTransitions,
  printSheetTransitions,
  type Transition,
} from "./transitions";

type Table = {
  name: string;
  rows: readonly Transition<string>[];
  statuses: readonly string[];
  initial: string;
};

const tables: Table[] = [
  {
    name: "注文",
    rows: orderTransitions,
    statuses: orderStatusSchema.options,
    initial: "submitted",
  },
  {
    name: "注文明細",
    rows: orderItemTransitions,
    statuses: orderItemStatusSchema.options,
    initial: "queued",
  },
  {
    name: "印刷シート",
    rows: printSheetTransitions,
    statuses: printSheetStatusSchema.options,
    initial: "printing",
  },
  {
    name: "アーカイブ",
    rows: archiveTransitions,
    statuses: archiveStatusSchema.options,
    initial: "pending_review",
  },
];

function reachableFrom(rows: readonly Transition<string>[], initial: string): Set<string> {
  const seen = new Set([initial]);
  const queue = [initial];
  while (queue.length > 0) {
    const current = queue.shift();
    for (const row of rows) {
      if (row.from === current && !seen.has(row.to)) {
        seen.add(row.to);
        queue.push(row.to);
      }
    }
  }
  return seen;
}

describe.each(tables)("$name の遷移表", ({ rows, statuses, initial }) => {
  test("from と to は、定義された状態だけ", () => {
    for (const row of rows) {
      expect(statuses).toContain(row.from);
      expect(statuses).toContain(row.to);
    }
  });

  test("同じ (from, to) の行が重複せず、自分自身への遷移もない", () => {
    const keys = rows.map((row) => `${row.from}->${row.to}`);
    expect(new Set(keys).size).toBe(keys.length);
    for (const row of rows) expect(row.from).not.toBe(row.to);
  });

  test("実行者が 1 人以上で、定義された役割だけ", () => {
    for (const row of rows) {
      expect(row.actors.length).toBeGreaterThan(0);
      for (const actor of row.actors) expect(actorSchema.safeParse(actor).success).toBe(true);
    }
  });

  test("最初の状態から、すべての状態に行ける", () => {
    expect([...reachableFrom(rows, initial)].sort()).toEqual([...statuses].sort());
  });
});

describe("注文の遷移の規則", () => {
  const find = (from: string, to: string) =>
    orderTransitions.find((row) => row.from === from && row.to === to);

  test("終わりの状態（失効・取り消し・返金済み）から出る遷移はない", () => {
    for (const terminal of ["expired", "cancelled", "refunded"]) {
      expect(orderTransitions.filter((row) => row.from === terminal)).toEqual([]);
    }
  });

  test("返金は、支払い後のどの状態からでもできる（受け渡し済みを含む）", () => {
    for (const from of ["paid", "assembling", "ready", "picked_up"]) {
      expect(find(from, "refunded")?.actors).toEqual(["staff"]);
    }
    expect(find("submitted", "refunded")).toBeUndefined();
  });

  test("再印刷は、受け渡し前の状態だけを印刷待ちに戻す", () => {
    for (const from of ["assembling", "ready"]) {
      expect(find(from, "paid")).toBeDefined();
    }
    expect(find("picked_up", "paid")).toBeUndefined();
  });

  test("支払いはスタッフだけ。印刷が終わったあとの、組み立て中への自動遷移は system だけ（組み立て開始の操作は、ない）", () => {
    expect(find("submitted", "paid")?.actors).toEqual(["staff"]);
    expect(find("paid", "assembling")?.actors).toEqual(["system"]);
    expect(orderTransitions.some((row) => (row.to as string) === "printed")).toBe(false);
  });

  test("明細の印刷の完了・失敗と、シートの確認済み・失敗は、system だけ（印刷の確認の操作は、ない）", () => {
    for (const row of [...orderItemTransitions, ...printSheetTransitions]) {
      if (row.from === "printed") continue; // 履歴からの再印刷は、スタッフ
      expect(row.actors).toEqual(["system"]);
    }
  });

  test("来場者が取り消せるのは、支払い前だけ", () => {
    const visitorRows = orderTransitions.filter((row) =>
      (row.actors as readonly string[]).includes("visitor"),
    );
    expect(visitorRows.map((row) => `${row.from}->${row.to}`)).toEqual(["submitted->cancelled"]);
  });
});
