import { describe, expect, test } from "bun:test";
import { orderStatusSchema } from "@canbadge/shared";
import {
  guideFor,
  justBecameReady,
  PROGRESS_STEPS,
  progressIndex,
  showsQr,
  stepState,
} from "./order-status";

const order = { totalAmount: 300, confirmationCode: "K7QH" };

describe("進み具合", () => {
  test("注文の流れに沿って、段階が進む。印刷済みと組み立て中は、同じ段階（組み立て）", () => {
    expect(progressIndex("submitted")).toBe(1);
    expect(progressIndex("paid")).toBe(2);
    expect(progressIndex("printed")).toBe(3);
    expect(progressIndex("assembling")).toBe(3);
    expect(progressIndex("ready")).toBe(4);
  });

  test("受け渡し済みは、全部の段階が済んでいる。取り消し・期限切れ・返金は、進み具合を出さない", () => {
    expect(progressIndex("picked_up")).toBe(PROGRESS_STEPS.length);
    for (const status of ["expired", "cancelled", "refunded"] as const) {
      expect(progressIndex(status)).toBeUndefined();
    }
  });

  test("段階の状態：前は済み、いまの段階が現在、あとは未着手", () => {
    expect(PROGRESS_STEPS.map((_, index) => stepState(index, 2))).toEqual([
      "done",
      "done",
      "now",
      "todo",
      "todo",
      "todo",
    ]);
    // 全部済み
    expect(PROGRESS_STEPS.map((_, index) => stepState(index, PROGRESS_STEPS.length))).toEqual(
      PROGRESS_STEPS.map(() => "done"),
    );
  });
});

describe("案内の文", () => {
  test("契約にある状態は、すべて案内がある（見出しと本文が空でない）", () => {
    for (const status of orderStatusSchema.options) {
      const guide = guideFor(status, order);
      expect(guide.headline.length).toBeGreaterThan(0);
      expect(guide.body.length).toBeGreaterThan(0);
    }
  });

  test("支払い待ちは金額を、できあがりは確認コードを案内する", () => {
    expect(guideFor("submitted", order).body).toContain("300円");
    const ready = guideFor("ready", order);
    expect(ready.body).toContain("K7QH");
    expect(ready.tone).toBe("ready");
  });

  test("止まった注文（取り消し・期限切れ）は、スタッフへ案内し、エラーを叫ばない", () => {
    for (const status of ["expired", "cancelled", "refunded"] as const) {
      const guide = guideFor(status, order);
      expect(guide.tone).toBe("stopped");
      expect(guide.body).toContain("スタッフ");
      expect(guide.headline + guide.body).not.toContain("！");
    }
  });
});

describe("QR を出す状態", () => {
  test("対応が続いている間だけ出す。済んだ・止まった注文には出さない", () => {
    for (const status of ["submitted", "paid", "printed", "assembling", "ready"] as const) {
      expect(showsQr(status)).toBe(true);
    }
    for (const status of ["picked_up", "expired", "cancelled", "refunded"] as const) {
      expect(showsQr(status)).toBe(false);
    }
  });
});

describe("できあがりの知らせ", () => {
  test("ready に変わった瞬間だけ。最初の表示や、ready のままの更新では、知らせない", () => {
    expect(justBecameReady("assembling", "ready")).toBe(true);
    expect(justBecameReady(undefined, "ready")).toBe(false);
    expect(justBecameReady("ready", "ready")).toBe(false);
    expect(justBecameReady("ready", "picked_up")).toBe(false);
  });
});
