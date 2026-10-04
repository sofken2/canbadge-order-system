import { describe, expect, test } from "bun:test";
import {
  apiErrorSchema,
  archiveEntrySchema,
  auditLogSchema,
  checkPrintSheetRequestSchema,
  createOrderRequestSchema,
  designSchema,
  errorCodeSchema,
  errorHttpStatus,
  monitorReadyItemSchema,
  monitorSseEventSchema,
  orderItemSchema,
  orderSchema,
  orderSseEventSchema,
  orderViewSchema,
  pickupRequestSchema,
  printSheetSchema,
  printSlotSchema,
  reportSchema,
  reprintRequestSchema,
  settingSchema,
  sseEventSchema,
  staffOrderSearchQuerySchema,
  staffOrderViewSchema,
  staffSseEventSchema,
} from "./index";

const A = "01HZX3V5Q8N4M6T2B9C7D1E0FA";
const B = "01HZX3V5Q8N4M6T2B9C7D1E0FB";
const C = "01HZX3V5Q8N4M6T2B9C7D1E0FC";
const at = "2026-11-03T09:30:00+09:00";
const token = "a".repeat(32);

const order = {
  id: A,
  businessDate: "2026-11-03",
  orderNumber: 7,
  confirmationCode: "K7QH",
  anonToken: token,
  status: "submitted",
  totalAmount: 300,
  createdAt: at,
};

describe("エンティティ", () => {
  test("注文・明細・デザイン", () => {
    expect(orderSchema.parse(order).orderNumber).toBe(7);
    expect(
      orderItemSchema.parse({
        id: B,
        orderId: A,
        designId: C,
        quantity: 1,
        status: "queued",
        printCount: 0,
      }).printCount,
    ).toBe(0);
    expect(
      designSchema.parse({
        id: C,
        imagePath: `images/${C}.png`,
        editorData: { version: 1, layers: [] },
        createdAt: at,
      }).editorData.version,
    ).toBe(1);
  });

  test("金額は円の整数だけ（小数・負数は断る）", () => {
    expect(orderSchema.safeParse({ ...order, totalAmount: 300.5 }).success).toBe(false);
    expect(orderSchema.safeParse({ ...order, totalAmount: -1 }).success).toBe(false);
  });

  test("編集データは version が必須で、ほかの項目はそのまま残る", () => {
    const base = { id: C, imagePath: "images/a.png", createdAt: at };
    expect(designSchema.safeParse({ ...base, editorData: {} }).success).toBe(false);
    const parsed = designSchema.parse({ ...base, editorData: { version: 2, strokes: [1, 2] } });
    expect(parsed.editorData).toEqual({ version: 2, strokes: [1, 2] });
  });

  test("印刷シートとシート上のバッジ", () => {
    expect(
      printSheetSchema.parse({ id: A, pdfPath: "sheets/a.pdf", status: "printing", printedAt: at })
        .status,
    ).toBe("printing");
    expect(
      printSlotSchema.parse({ sheetId: A, position: 0, orderItemId: B, result: "pending" })
        .position,
    ).toBe(0);
  });

  test("設定", () => {
    const setting = {
      businessDate: null,
      acceptance: "closed",
      busyMessage: null,
      price: 300,
      maxQuantityPerOrder: 1,
      maxPendingPerDevice: 2,
      printMaxWaitSeconds: 120,
      printPaused: false,
      orderNumberDigits: 3,
      imageMaxBytes: 10_000_000,
      updatedAt: at,
    };
    expect(settingSchema.parse(setting).acceptance).toBe("closed");
    expect(settingSchema.safeParse({ ...setting, maxQuantityPerOrder: 0 }).success).toBe(false);
    expect(settingSchema.safeParse({ ...setting, orderNumberDigits: 9 }).success).toBe(false);
  });

  test("アーカイブは、同意が揃っていないと作れない", () => {
    const entry = {
      id: A,
      designId: C,
      displayName: "たつ",
      status: "pending_review",
      consent: { selfMade: true, allowOthersToOrder: true, agreedAt: at },
      authorAnonToken: token,
      createdAt: at,
    };
    expect(archiveEntrySchema.parse(entry).displayName).toBe("たつ");
    const noConsent = { ...entry, consent: { ...entry.consent, selfMade: false } };
    expect(archiveEntrySchema.safeParse(noConsent).success).toBe(false);
    expect(
      reportSchema.parse({
        id: B,
        archiveEntryId: A,
        reason: "転載",
        status: "open",
        createdAt: at,
      }).status,
    ).toBe("open");
  });

  test("操作ログ", () => {
    const log = auditLogSchema.parse({
      id: A,
      actor: "system",
      at,
      action: "transition",
      targetType: "order",
      targetId: B,
      detail: { from: "paid", to: "printed" },
    });
    expect(log.detail).toEqual({ from: "paid", to: "printed" });
  });
});

describe("API の入出力", () => {
  test("注文の作成は、権利確認への同意と Turnstile のトークンが必須", () => {
    const body = {
      imageId: A,
      editorData: { version: 1 },
      quantity: 1,
      turnstileToken: "token",
      rightsConsent: true,
    };
    expect(createOrderRequestSchema.safeParse(body).success).toBe(true);
    expect(createOrderRequestSchema.safeParse({ ...body, rightsConsent: false }).success).toBe(
      false,
    );
    expect(createOrderRequestSchema.safeParse({ ...body, turnstileToken: "" }).success).toBe(false);
    expect(createOrderRequestSchema.safeParse({ ...body, quantity: 0 }).success).toBe(false);
  });

  test("来場者向けの注文は確認コードを含み、匿名トークンは含めない", () => {
    const view = {
      id: A,
      businessDate: "2026-11-03",
      orderNumber: 7,
      orderNumberText: "007",
      confirmationCode: "K7QH",
      status: "paid",
      totalAmount: 300,
      createdAt: at,
      items: [],
      anonToken: token,
    };
    const parsed = orderViewSchema.parse(view);
    expect(parsed.confirmationCode).toBe("K7QH");
    expect("anonToken" in parsed).toBe(false);
  });

  test("スタッフ向けの注文は、確認コードを含めない", () => {
    const parsed = staffOrderViewSchema.parse({
      id: A,
      businessDate: "2026-11-03",
      orderNumber: 7,
      orderNumberText: "007",
      status: "paid",
      totalAmount: 300,
      createdAt: at,
      items: [],
      confirmationCode: "K7QH",
      anonToken: token,
    });
    expect("confirmationCode" in parsed).toBe(false);
    expect("anonToken" in parsed).toBe(false);
  });

  test("呼び出しモニターには、注文 ID（QR の中身）を含めない", () => {
    const parsed = monitorReadyItemSchema.parse({
      orderNumber: 7,
      orderNumberText: "007",
      readyAt: at,
      orderId: A,
    });
    expect("orderId" in parsed).toBe(false);
  });

  test("注文の検索は、カンマ区切りの状態を配列にし、件数の既定は 30", () => {
    const parsed = staffOrderSearchQuerySchema.parse({ status: "printed,assembling,ready" });
    expect(parsed.status).toEqual(["printed", "assembling", "ready"]);
    expect(parsed.limit).toBe(30);
    expect(staffOrderSearchQuerySchema.safeParse({ status: "printed,nope" }).success).toBe(false);
    expect(staffOrderSearchQuerySchema.safeParse({ limit: "500" }).success).toBe(false);
  });

  test("受け渡しの確認コードは、小文字でも受け付ける", () => {
    expect(pickupRequestSchema.parse({ confirmationCode: "k7qh" }).confirmationCode).toBe("K7QH");
  });

  test("印刷の確認は、再印刷の指定が空でもよい。再印刷は 1 個以上", () => {
    expect(checkPrintSheetRequestSchema.parse({}).reprintOrderItemIds).toEqual([]);
    expect(reprintRequestSchema.safeParse({ orderItemIds: [] }).success).toBe(false);
    expect(reprintRequestSchema.safeParse({ orderItemIds: [A, B] }).success).toBe(true);
  });
});

describe("エラー", () => {
  test("すべての code に HTTP ステータスがある", () => {
    expect(Object.keys(errorHttpStatus).sort()).toEqual([...errorCodeSchema.options].sort());
  });

  test("失敗時の本体の形", () => {
    const parsed = apiErrorSchema.parse({
      error: {
        code: "NOT_ACCEPTING",
        message: "混雑のため停止中です",
        details: { acceptance: "busy" },
      },
    });
    expect(parsed.error.code).toBe("NOT_ACCEPTING");
    expect(errorHttpStatus.NOT_ACCEPTING).toBe(503);
  });
});

describe("SSE イベント", () => {
  const events = [
    { type: "order.updated", orderId: A, status: "paid" },
    { type: "queue.updated" },
    { type: "sheet.updated", sheetId: B, status: "confirmed" },
    { type: "monitor.updated" },
    { type: "settings.updated" },
  ];

  test("5 種類すべてを読める。知らない type は断る", () => {
    for (const event of events) expect(sseEventSchema.safeParse(event).success).toBe(true);
    expect(sseEventSchema.safeParse({ type: "unknown" }).success).toBe(false);
  });

  test("購読の種類ごとに、流してよいイベントが限られる", () => {
    for (const event of events) expect(staffSseEventSchema.safeParse(event).success).toBe(true);
    expect(
      events.filter((e) => orderSseEventSchema.safeParse(e).success).map((e) => e.type),
    ).toEqual(["order.updated"]);
    expect(
      events.filter((e) => monitorSseEventSchema.safeParse(e).success).map((e) => e.type),
    ).toEqual(["monitor.updated"]);
  });
});
