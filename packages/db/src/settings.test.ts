import { describe, expect, test } from "bun:test";
import { listAuditLogsSince } from "./audit";
import type { DbError } from "./errors";
import { getOrder, getSetting } from "./queries";
import {
  businessDateOf,
  DEFAULT_BUSY_MESSAGE,
  defaultSetting,
  ensureSetting,
  openBusinessDay,
  setAcceptance,
  setPrintPaused,
  updateSetting,
} from "./settings";
import { paidOrder, placeOrder, setup, setupClosed } from "./test-helpers";

describe("設定の初期値", () => {
  test("営業開始の前は、受付終了で、営業日がない", () => {
    const { db } = setupClosed();
    const setting = getSetting(db.orm);
    expect(setting).toMatchObject({ ...defaultSetting, acceptance: "closed", businessDate: null });
  });

  test("ensureSetting は、何度呼んでも行を増やさず、変更した値も戻さない", () => {
    const { db } = setup();
    setPrintPaused(db, { paused: true, actor: "staff" });
    ensureSetting(db);
    ensureSetting(db);
    expect(getSetting(db.orm).printPaused).toBe(true);
    expect(db.sqlite.query("SELECT count(*) AS n FROM settings").get()).toEqual({ n: 1 });
  });
});

describe("営業日", () => {
  test("日本時間の日付で決まる（UTC では前日でも、日本時間の日付）", () => {
    expect(businessDateOf(new Date("2026-11-03T00:30:00+09:00"))).toBe("2026-11-03");
    expect(businessDateOf(new Date("2026-11-03T23:30:00+09:00"))).toBe("2026-11-03");
    expect(businessDateOf(new Date("2026-11-03T15:00:00Z"))).toBe("2026-11-04");
  });

  test("営業開始で、営業日が今日になり、受付が open になる", () => {
    const { db } = setupClosed("2026-11-03T00:30:00+09:00");
    const setting = openBusinessDay(db, { actor: "staff" });
    expect(setting).toMatchObject({ businessDate: "2026-11-03", acceptance: "open" });
  });

  test("営業開始で、前の営業日の支払い待ちだけが失効し、支払い済みは残る", () => {
    const { db, clock } = setup();
    const waiting = placeOrder(db).order;
    const paid = paidOrder(db).order;

    clock.advance(24 * 60 * 60 * 1000);
    openBusinessDay(db, { actor: "staff" });
    expect(getOrder(db.orm, waiting.id)?.status).toBe("expired");
    expect(getOrder(db.orm, paid.id)?.status).toBe("paid");
  });

  test("同じ日に営業開始を押し直しても、その日の支払い待ちは失効しない", () => {
    const { db } = setup();
    const waiting = placeOrder(db).order;
    openBusinessDay(db, { actor: "staff" });
    expect(getOrder(db.orm, waiting.id)?.status).toBe("submitted");
  });
});

describe("受付状態", () => {
  test("ビジーは案内文を持ち、解除すると消える。支払い待ちは失効しない", () => {
    const { db } = setup();
    const waiting = placeOrder(db).order;

    expect(setAcceptance(db, { acceptance: "busy", actor: "staff" })).toMatchObject({
      acceptance: "busy",
      busyMessage: DEFAULT_BUSY_MESSAGE,
    });
    expect(
      setAcceptance(db, {
        acceptance: "busy",
        busyMessage: "  15 分お待ちください ",
        actor: "staff",
      }).busyMessage,
    ).toBe("15 分お待ちください");
    expect(getOrder(db.orm, waiting.id)?.status).toBe("submitted");

    const reopened = setAcceptance(db, { acceptance: "open", actor: "staff" });
    expect(reopened).toMatchObject({ acceptance: "open", busyMessage: null });
  });

  test("受付終了にすると、その日の支払い待ちが失効し、支払い済みは残る", () => {
    const { db } = setup();
    const waiting = placeOrder(db).order;
    const paid = paidOrder(db).order;
    setAcceptance(db, { acceptance: "closed", actor: "staff" });
    expect(getOrder(db.orm, waiting.id)?.status).toBe("expired");
    expect(getOrder(db.orm, paid.id)?.status).toBe("paid");
  });

  test("失効は注文ごとに遷移関数を通り、system の操作として記録される", () => {
    const { db } = setup();
    const waiting = placeOrder(db).order;
    setAcceptance(db, { acceptance: "closed", actor: "staff" });
    const logs = listAuditLogsSince(db, 0).map((entry) => entry.log);
    expect(
      logs.find(
        (l) => l.action === "order.transition" && l.targetId === waiting.id && l.actor === "system",
      )?.detail,
    ).toMatchObject({ from: "submitted", to: "expired" });
    expect(logs.find((l) => l.action === "acceptance.set")?.detail).toMatchObject({
      to: "closed",
      expiredOrders: 1,
    });
  });
});

describe("印刷の一時停止と設定の更新", () => {
  test("一時停止と再開が記録される", () => {
    const { db } = setup();
    expect(setPrintPaused(db, { paused: true, actor: "staff" }).printPaused).toBe(true);
    expect(setPrintPaused(db, { paused: false, actor: "staff" }).printPaused).toBe(false);
    const actions = listAuditLogsSince(db, 0).map((e) => e.log.action);
    expect(actions).toContain("print_queue.pause");
    expect(actions).toContain("print_queue.resume");
  });

  test("価格や上限を置き換えられるが、不正な値は断る", () => {
    const { db } = setup();
    const values = {
      price: 400,
      kiraFilmPrice: 100,
      maxQuantityPerOrder: 2,
      maxPendingPerDevice: 3,
      printMaxWaitSeconds: 60,
      orderNumberDigits: 4,
      imageMaxBytes: 5_000_000,
    };
    expect(updateSetting(db, { values, actor: "staff" })).toMatchObject(values);

    for (const bad of [{ price: -1 }, { maxQuantityPerOrder: 0 }, { orderNumberDigits: 9 }]) {
      try {
        updateSetting(db, { values: { ...values, ...bad }, actor: "staff" });
        throw new Error("例外になるはず");
      } catch (error) {
        expect((error as DbError).code).toBe("VALIDATION_FAILED");
      }
    }
    expect(getSetting(db.orm).price).toBe(400);
  });
});
