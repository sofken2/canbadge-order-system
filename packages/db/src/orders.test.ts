import { describe, expect, test } from "bun:test";
import { confirmationCodeSchema } from "@canbadge/shared";
import { listAuditLogsSince } from "./audit";
import { DbError } from "./errors";
import { applyOrderTransition, countPendingOrders, createOrder, transitionOrder } from "./orders";
import { getOrder, getOrderByNumber, listOrderItems } from "./queries";
import { openBusinessDay, setAcceptance, updateSetting } from "./settings";
import { checkPrintSheet, createPrintSheet } from "./sheets";
import { payOrder, placeOrder, setup, setupClosed, TOKEN } from "./test-helpers";
import { write } from "./transaction";

function codeOf(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (error) {
    return error instanceof DbError ? error.code : `OTHER:${String(error)}`;
  }
  return undefined;
}

describe("注文の作成", () => {
  test("営業開始の前は注文できない（NOT_ACCEPTING）", () => {
    const { db } = setupClosed();
    expect(codeOf(() => placeOrder(db))).toBe("NOT_ACCEPTING");
  });

  test("注文・明細・デザインが作られ、支払い待ちで始まる", () => {
    const { db } = setup();
    const { order, items, design } = placeOrder(db, 1, TOKEN);
    expect(order.status).toBe("submitted");
    expect(order.businessDate).toBe("2026-11-03");
    expect(order.totalAmount).toBe(300);
    expect(confirmationCodeSchema.safeParse(order.confirmationCode).success).toBe(true);
    expect(order.anonToken).toBe(TOKEN);
    expect(items).toHaveLength(1);
    expect(items[0]?.status).toBe("queued");
    expect(items[0]?.printCount).toBe(0);
    expect(items[0]?.designId).toBe(design.id);
    expect(design.imagePath).toBe("images/sample.png");
  });

  test("注文番号は、営業日ごとに 1 から連番で振る", () => {
    const { db, clock } = setup();
    const numbers = [placeOrder(db), placeOrder(db), placeOrder(db)].map(
      (c) => c.order.orderNumber,
    );
    expect(numbers).toEqual([1, 2, 3]);

    // 翌日の営業開始で、番号は 1 に戻る（前の日の支払い待ちは失効する）
    clock.advance(24 * 60 * 60 * 1000);
    openBusinessDay(db, { actor: "staff" });
    const next = placeOrder(db);
    expect(next.order.businessDate).toBe("2026-11-04");
    expect(next.order.orderNumber).toBe(1);
    expect(getOrderByNumber(db.orm, "2026-11-03", 1)?.status).toBe("expired");
    expect(getOrderByNumber(db.orm, "2026-11-04", 1)?.id).toBe(next.order.id);
  });

  test("合計金額は、価格 × 個数（円の整数）", () => {
    const { db } = setup();
    updateSetting(db, {
      actor: "staff",
      values: {
        price: 250,
        maxQuantityPerOrder: 3,
        maxPendingPerDevice: 2,
        printMaxWaitSeconds: 120,
        orderNumberDigits: 3,
        imageMaxBytes: 1000,
      },
    });
    const { order, items } = placeOrder(db, 3);
    expect(order.totalAmount).toBe(750);
    expect(items[0]?.quantity).toBe(3);
  });

  test("個数が上限を超えたら断る", () => {
    const { db } = setup();
    expect(codeOf(() => placeOrder(db, 2))).toBe("VALIDATION_FAILED");
  });

  test("ビジー・受付終了のときは断り、案内文を返す", () => {
    const { db } = setup();
    setAcceptance(db, { acceptance: "busy", actor: "staff" });
    try {
      placeOrder(db);
      throw new Error("例外になるはず");
    } catch (error) {
      expect(error).toBeInstanceOf(DbError);
      const e = error as DbError;
      expect(e.code).toBe("NOT_ACCEPTING");
      expect(e.message).toContain("混雑");
      expect(e.details).toEqual({ acceptance: "busy", busyMessage: e.message });
    }
    setAcceptance(db, { acceptance: "closed", actor: "staff" });
    expect(codeOf(() => placeOrder(db))).toBe("NOT_ACCEPTING");
  });

  test("入力が契約に合わなければ断る（空の画像パス・親ディレクトリ・短い匿名トークン）", () => {
    const { db } = setup();
    const base = {
      imagePath: "images/a.png",
      editorData: { version: 1 },
      quantity: 1,
      anonToken: TOKEN,
    };
    expect(codeOf(() => createOrder(db, { ...base, imagePath: "../a.png" }))).toBe(
      "VALIDATION_FAILED",
    );
    expect(codeOf(() => createOrder(db, { ...base, anonToken: "short" }))).toBe(
      "VALIDATION_FAILED",
    );
    expect(codeOf(() => createOrder(db, { ...base, editorData: {} as never }))).toBe(
      "VALIDATION_FAILED",
    );
  });
});

describe("注文の遷移", () => {
  test("支払い → 完成 → 受け渡しで、それぞれの時刻が記録される", () => {
    const { db, clock } = setup();
    const { order: created } = placeOrder(db);
    const id = created.id;

    clock.advance(60_000);
    const paid = payOrder(db, id);
    expect(paid.status).toBe("paid");
    expect(paid.paidAt).toBe("2026-11-03T00:01:00.000Z");

    // 印刷して確認すると、注文は自動で印刷済みになる（印刷の詳細は printing.test.ts）
    const itemId = listOrderItems(db.orm, id)[0]?.id ?? "";
    const { sheet } = createPrintSheet(db, { pdfPath: "sheets/s.pdf", orderItemIds: [itemId] });
    checkPrintSheet(db, { sheetId: sheet.id, reprintOrderItemIds: [], actor: "staff" });
    expect(getOrder(db.orm, id)?.status).toBe("printed");
    transitionOrder(db, { orderId: id, to: "assembling", actor: "staff" });
    clock.advance(60_000);
    const ready = transitionOrder(db, { orderId: id, to: "ready", actor: "staff" });
    expect(ready.readyAt).toBe("2026-11-03T00:02:00.000Z");
    clock.advance(60_000);
    const pickedUp = transitionOrder(db, { orderId: id, to: "picked_up", actor: "staff" });
    expect(pickedUp.pickedUpAt).toBe("2026-11-03T00:03:00.000Z");

    // 受け渡し済みからも、全額返金できる
    clock.advance(60_000);
    const refunded = transitionOrder(db, { orderId: id, to: "refunded", actor: "staff" });
    expect(refunded.status).toBe("refunded");
    expect(refunded.refundedAt).toBe("2026-11-03T00:04:00.000Z");
  });

  test("遷移表にない遷移は断る（支払いを 2 回、取り消し済みの支払い）", () => {
    const { db } = setup();
    const { order } = placeOrder(db);
    payOrder(db, order.id);
    expect(codeOf(() => payOrder(db, order.id))).toBe("INVALID_TRANSITION");

    const other = placeOrder(db).order;
    transitionOrder(db, { orderId: other.id, to: "cancelled", actor: "visitor" });
    expect(codeOf(() => payOrder(db, other.id))).toBe("INVALID_TRANSITION");
    expect(getOrder(db.orm, other.id)?.status).toBe("cancelled");
  });

  test("できない役割の操作は断る（来場者の支払い、スタッフ以外の完成）", () => {
    const { db } = setup();
    const { order } = placeOrder(db);
    const visitorPay = () =>
      transitionOrder(db, { orderId: order.id, to: "paid", actor: "visitor" });
    expect(codeOf(visitorPay)).toBe("INVALID_TRANSITION");
    expect(getOrder(db.orm, order.id)?.status).toBe("submitted");
  });

  test("来場者は、支払い前なら取り消せるが、支払い後は取り消せない", () => {
    const { db } = setup();
    const a = placeOrder(db).order;
    expect(transitionOrder(db, { orderId: a.id, to: "cancelled", actor: "visitor" }).status).toBe(
      "cancelled",
    );
    const b = placeOrder(db).order;
    payOrder(db, b.id);
    expect(
      codeOf(() => transitionOrder(db, { orderId: b.id, to: "cancelled", actor: "visitor" })),
    ).toBe("INVALID_TRANSITION");
  });

  test("全明細が印刷済みでないと、印刷済みにできない", () => {
    const { db } = setup();
    const { order } = placeOrder(db);
    payOrder(db, order.id);
    expect(
      codeOf(() => transitionOrder(db, { orderId: order.id, to: "printed", actor: "system" })),
    ).toBe("INVALID_TRANSITION");
  });

  test("存在しない注文は NOT_FOUND", () => {
    const { db } = setup();
    expect(codeOf(() => payOrder(db, "01HZX3V5Q8N4M6T2B9C7D1E0FA"))).toBe("NOT_FOUND");
  });

  test("明細は、注文と一緒に作られた 1 件", () => {
    const { db } = setup();
    const { order } = placeOrder(db);
    expect(listOrderItems(db.orm, order.id)).toHaveLength(1);
  });
});

describe("操作ログと整合性", () => {
  test("遷移ごとに、誰が・いつ・何から何へ変えたかが記録される", () => {
    const { db, clock } = setup();
    const { order } = placeOrder(db);
    clock.advance(1000);
    payOrder(db, order.id);

    const logs = listAuditLogsSince(db, 0).map((entry) => entry.log);
    const created = logs.find((l) => l.action === "order.create" && l.targetId === order.id);
    const transition = logs.find((l) => l.action === "order.transition" && l.targetId === order.id);
    expect(created?.actor).toBe("visitor");
    expect(transition).toMatchObject({
      actor: "staff",
      targetType: "order",
      detail: { from: "submitted", to: "paid" },
    });
    expect(transition?.at).toBe("2026-11-03T00:00:01.000Z");
  });

  test("通し番号（seq）の順に読めて、前回の続きから読み直せる", () => {
    const { db } = setup();
    const first = listAuditLogsSince(db, 0);
    const last = first.at(-1)?.seq ?? 0;
    placeOrder(db);
    const added = listAuditLogsSince(db, last);
    expect(added.map((e) => e.log.action)).toEqual(["order.create"]);
    expect(added[0]?.seq).toBeGreaterThan(last);
  });

  test("途中で失敗すると、状態の変更も操作ログも、すべて取り消される", () => {
    const { db } = setup();
    const { order } = placeOrder(db);
    const before = listAuditLogsSince(db, 0).length;

    expect(() =>
      write(db, (ctx) => {
        applyOrderTransition(ctx, { orderId: order.id, to: "paid", actor: "staff" });
        throw new Error("途中で失敗");
      }),
    ).toThrow("途中で失敗");

    expect(getOrder(db.orm, order.id)?.status).toBe("submitted");
    expect(listAuditLogsSince(db, 0)).toHaveLength(before);
  });

  test("読んだあとに別の操作で状態が変わっていたら、競合として断る（二重遷移の防止）", () => {
    const { db } = setup();
    const { order } = placeOrder(db);
    // 別のプロセスが先に更新した状況を、更新を無視するトリガーで再現する
    db.sqlite.exec(
      "CREATE TRIGGER ignore_pay BEFORE UPDATE ON orders WHEN NEW.status = 'paid' BEGIN SELECT RAISE(IGNORE); END",
    );
    const before = listAuditLogsSince(db, 0).length;
    expect(codeOf(() => payOrder(db, order.id))).toBe("CONFLICT");
    expect(listAuditLogsSince(db, 0)).toHaveLength(before);
  });
});

describe("1 端末あたりの支払い待ちの上限（A06）", () => {
  const OTHER = "b".repeat(32);

  test("上限（既定 2 件）に達したら、RATE_LIMITED で断る。別の端末は、そのまま注文できる", () => {
    const { db } = setup();
    placeOrder(db, 1, TOKEN);
    placeOrder(db, 1, TOKEN);
    expect(codeOf(() => placeOrder(db, 1, TOKEN))).toBe("RATE_LIMITED");
    expect(() => placeOrder(db, 1, OTHER)).not.toThrow();
  });

  test("断った注文は、作られない（番号も進まない）", () => {
    const { db } = setup();
    placeOrder(db, 1, TOKEN);
    placeOrder(db, 1, TOKEN);
    codeOf(() => placeOrder(db, 1, TOKEN));
    expect(placeOrder(db, 1, OTHER).order.orderNumber).toBe(3);
  });

  test("支払い・取り消しで、支払い待ちが減れば、また注文できる", () => {
    const { db } = setup();
    const first = placeOrder(db, 1, TOKEN);
    placeOrder(db, 1, TOKEN);
    expect(countPendingOrders(db.orm, TOKEN)).toBe(2);

    payOrder(db, first.order.id);
    expect(countPendingOrders(db.orm, TOKEN)).toBe(1);
    expect(() => placeOrder(db, 1, TOKEN)).not.toThrow();
    expect(codeOf(() => placeOrder(db, 1, TOKEN))).toBe("RATE_LIMITED");
  });

  test("数えるのは、支払い待ち（submitted）だけ。支払い済み・取り消し・期限切れは、数えない", () => {
    const { db } = setup();
    const a = placeOrder(db, 1, TOKEN);
    const b = placeOrder(db, 1, TOKEN);
    payOrder(db, a.order.id);
    transitionOrder(db, { orderId: b.order.id, to: "cancelled", actor: "visitor" });
    expect(countPendingOrders(db.orm, TOKEN)).toBe(0);
    placeOrder(db, 1, TOKEN);
    placeOrder(db, 1, TOKEN);
    setAcceptance(db, { acceptance: "closed", actor: "staff" });
    expect(countPendingOrders(db.orm, TOKEN)).toBe(0);
  });

  test("上限は設定（maxPendingPerDevice）に従う。1 にすれば、2 件目から断る", () => {
    const { db } = setup();
    updateSetting(db, {
      actor: "staff",
      values: {
        price: 300,
        maxQuantityPerOrder: 1,
        maxPendingPerDevice: 1,
        printMaxWaitSeconds: 60,
        orderNumberDigits: 3,
        imageMaxBytes: 1000,
      },
    });
    placeOrder(db, 1, TOKEN);
    expect(codeOf(() => placeOrder(db, 1, TOKEN))).toBe("RATE_LIMITED");
  });

  test("断るときの文に、上限と、してほしいこと（支払う・取り消す）が入る", () => {
    const { db } = setup();
    placeOrder(db, 1, TOKEN);
    placeOrder(db, 1, TOKEN);
    try {
      placeOrder(db, 1, TOKEN);
    } catch (error) {
      expect(error).toBeInstanceOf(DbError);
      const message = (error as DbError).message;
      expect(message).toContain("2 件");
      expect(message).toContain("支払う");
      expect(message).toContain("取り消して");
    }
  });
});
