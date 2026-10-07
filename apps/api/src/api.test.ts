import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { transitionOrder } from "@canbadge/db";
import { encodePng, sampleImageIds } from "@canbadge/fixtures";
import { apiErrorSchema } from "@canbadge/shared";
import sharp from "sharp";
import { call, createTestApp, openSse, type TestApp } from "./test-helpers";

let t: TestApp;
beforeEach(() => {
  t = createTestApp();
});
afterEach(async () => await t.close());

/** 失敗時の本体が、契約の形（{ error: { code, message } }）であることを確かめて、code を返す */
async function errorCode(response: Response): Promise<string> {
  const parsed = apiErrorSchema.parse(await response.json());
  return parsed.error.code;
}

const orderBody = (imageId: string) => ({
  imageId,
  editorData: { version: 1 },
  quantity: 1,
  turnstileToken: "dummy",
  rightsConsent: true,
});

describe("失敗時の応答", () => {
  test("存在しない注文は 404 NOT_FOUND", async () => {
    const res = await call(t.app, "GET", "/api/orders/01HZX3V5Q8N4M6T2B9C7D1E0FA");
    expect(res.status).toBe(404);
    expect(await errorCode(res)).toBe("NOT_FOUND");
  });

  test("ID の形が違えば 400 VALIDATION_FAILED（項目ごとの詳細つき）", async () => {
    const res = await call(t.app, "GET", "/api/orders/not-an-id");
    expect(res.status).toBe(400);
    const body = apiErrorSchema.parse(await res.json());
    expect(body.error.code).toBe("VALIDATION_FAILED");
    expect(Array.isArray(body.error.details)).toBe(true);
  });

  test("本体が JSON でない・契約に合わないときも 400", async () => {
    const notJson = await t.app.request("/api/orders/lookup", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{",
    });
    expect(notJson.status).toBe(400);
    expect(await errorCode(notJson)).toBe("VALIDATION_FAILED");

    const wrong = await call(t.app, "POST", "/api/orders/lookup", { json: { orderNumber: "x" } });
    expect(wrong.status).toBe(400);
  });

  test("存在しないアドレスは、契約の形で 404", async () => {
    const res = await call(t.app, "GET", "/api/nothing-here");
    expect(res.status).toBe(404);
    expect(await errorCode(res)).toBe("NOT_FOUND");
  });

  test("遷移できない操作は 409 INVALID_TRANSITION", async () => {
    const res = await call(t.app, "POST", `/api/staff/orders/${t.orderId("pickedUp")}/pay`);
    expect(res.status).toBe(409);
    expect(await errorCode(res)).toBe("INVALID_TRANSITION");
  });
});

describe("注文と受付状態", () => {
  async function upload(): Promise<string> {
    const form = new FormData();
    form.set(
      "file",
      new File([encodePng(2, 2, new Uint8Array(12))], "a.png", { type: "image/png" }),
    );
    const res = await call(t.app, "POST", "/api/images", { form });
    return ((await res.json()) as { imageId: string }).imageId;
  }

  test("ビジーのときは、注文を 503 NOT_ACCEPTING で断り、案内文を返す", async () => {
    await call(t.app, "POST", "/api/staff/acceptance", {
      json: { acceptance: "busy", busyMessage: "15 分お待ちください" },
    });
    const status = await (await call(t.app, "GET", "/api/status")).json();
    expect(status).toMatchObject({ acceptance: "busy", busyMessage: "15 分お待ちください" });

    const res = await call(t.app, "POST", "/api/orders", { json: orderBody(await upload()) });
    expect(res.status).toBe(503);
    const body = apiErrorSchema.parse(await res.json());
    expect(body.error).toMatchObject({
      code: "NOT_ACCEPTING",
      details: { acceptance: "busy", busyMessage: "15 分お待ちください" },
    });
  });

  test("権利確認に同意しない注文は断る", async () => {
    const res = await call(t.app, "POST", "/api/orders", {
      json: { ...orderBody(await upload()), rightsConsent: false },
    });
    expect(res.status).toBe(400);
  });

  test("アップロードされていない画像の注文は断る", async () => {
    const res = await call(t.app, "POST", "/api/orders", {
      json: orderBody("01HZX3V5Q8N4M6T2B9C7D1E0FA"),
    });
    expect(res.status).toBe(400);
    expect(await errorCode(res)).toBe("VALIDATION_FAILED");
  });

  test("取り消せるのは、注文した本人（匿名トークンの Cookie の持ち主）だけ", async () => {
    const created = await call(t.app, "POST", "/api/orders", { json: orderBody(await upload()) });
    const orderId = ((await created.json()) as { orderId: string }).orderId;
    const cookie = (created.headers.get("set-cookie") ?? "").split(";")[0] ?? "";

    const noCookie = await call(t.app, "POST", `/api/orders/${orderId}/cancel`);
    expect(noCookie.status).toBe(404);
    const otherCookie = await call(t.app, "POST", `/api/orders/${orderId}/cancel`, {
      headers: { cookie: `anon_token=${"z".repeat(32)}` },
    });
    expect(otherCookie.status).toBe(404);

    const mine = await call(t.app, "POST", `/api/orders/${orderId}/cancel`, {
      headers: { cookie },
    });
    expect(mine.status).toBe(200);
    expect(await mine.json()).toMatchObject({ status: "cancelled" });
  });

  test("注文照会は、番号と確認コードが合うときだけ。どちらが違っても同じ 404", async () => {
    const waiting = t.summary.orders.waiting;
    const ok = await call(t.app, "POST", "/api/orders/lookup", {
      json: {
        orderNumber: waiting?.orderNumber,
        confirmationCode: t.confirmationCode("waiting").toLowerCase(),
      },
    });
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ orderId: t.orderId("waiting") });

    const wrongCode = await call(t.app, "POST", "/api/orders/lookup", {
      json: { orderNumber: waiting?.orderNumber, confirmationCode: "2222" },
    });
    const wrongNumber = await call(t.app, "POST", "/api/orders/lookup", {
      json: { orderNumber: 999, confirmationCode: t.confirmationCode("waiting") },
    });
    expect(wrongCode.status).toBe(404);
    expect(wrongNumber.status).toBe(404);
    expect(await wrongCode.json()).toEqual(await wrongNumber.json());
  });
});

describe("受け渡し", () => {
  test("確認コードが違えば 409 CONFIRMATION_MISMATCH で、状態は変わらない", async () => {
    const orderId = t.orderId("readyNew");
    const code = t.confirmationCode("readyNew");
    const res = await call(t.app, "POST", `/api/staff/orders/${orderId}/pickup`, {
      json: { confirmationCode: code === "2222" ? "3333" : "2222" },
    });
    expect(res.status).toBe(409);
    expect(await errorCode(res)).toBe("CONFIRMATION_MISMATCH");

    const list = await (await call(t.app, "GET", `/api/staff/orders?q=${orderId}`)).json();
    expect((list as { items: { status: string }[] }).items[0]?.status).toBe("ready");
  });

  test("小文字で入力しても受け付ける", async () => {
    const res = await call(t.app, "POST", `/api/staff/orders/${t.orderId("readyNew")}/pickup`, {
      json: { confirmationCode: ` ${t.confirmationCode("readyNew").toLowerCase()} ` },
    });
    expect(res.status).toBe(200);
  });
});

describe("秘密を画面に返さない", () => {
  test("来場者向けの注文は確認コードを含み、匿名トークンは含まない", async () => {
    const res = await call(t.app, "GET", `/api/orders/${t.orderId("readyNew")}`);
    const text = await res.text();
    expect(text).toContain(t.confirmationCode("readyNew"));
    expect(text).not.toContain(t.anonToken("readyNew"));
    expect(text).not.toContain("anonToken");
  });

  test("スタッフ向けの注文は、確認コードも匿名トークンも含まない", async () => {
    const res = await call(t.app, "GET", `/api/staff/orders?q=${t.orderId("readyNew")}`);
    const text = await res.text();
    expect(text).not.toContain(t.confirmationCode("readyNew"));
    expect(text).not.toContain(t.anonToken("readyNew"));
    expect(text).not.toContain("confirmationCode");
  });

  test("呼び出しモニターは、注文 ID（QR の中身）を含まない", async () => {
    const res = await call(t.app, "GET", "/api/monitor/ready");
    const text = await res.text();
    expect(text).not.toContain(t.orderId("readyNew"));
    expect(text).not.toContain(t.orderId("readyLong"));
    expect(text).not.toContain("orderId");
  });
});

describe("公開経路からのスタッフ用 API", () => {
  test("Cloudflare を通ったリクエスト（cf-ray 付き）は、スタッフ用・モニター用を 401 で断る", async () => {
    for (const path of ["/api/staff/settings", "/api/staff/orders", "/api/monitor/ready"]) {
      const res = await call(t.app, "GET", path, { headers: { "cf-ray": "abc123-NRT" } });
      expect({ path, status: res.status }).toEqual({ path, status: 401 });
      expect(await errorCode(res)).toBe("UNAUTHORIZED");
    }
  });

  test("来場者向けは、公開経路からも使える。会場の PC（ヘッダーなし）からはスタッフ用も使える", async () => {
    const visitor = await call(t.app, "GET", "/api/status", {
      headers: { "cf-ray": "abc123-NRT" },
    });
    expect(visitor.status).toBe(200);
    const local = await call(t.app, "GET", "/api/staff/settings");
    expect(local.status).toBe(200);
  });

  test("開発で明示的に許したときだけ、公開経路からも使える", async () => {
    const open = createTestApp({ allowPublicStaff: true });
    try {
      const res = await call(open.app, "GET", "/api/staff/settings", {
        headers: { "cf-ray": "x" },
      });
      expect(res.status).toBe(200);
    } finally {
      await open.close();
    }
  });
});

describe("画像のアップロードと配信", () => {
  test("PNG・JPEG だけを、中身で判定して受け付ける", async () => {
    const text = new FormData();
    text.set("file", new File(["これは画像ではありません"], "a.png", { type: "image/png" }));
    const res = await call(t.app, "POST", "/api/images", { form: text });
    expect(res.status).toBe(415);
    expect(await errorCode(res)).toBe("UNSUPPORTED_MEDIA_TYPE");

    const jpeg = new FormData();
    jpeg.set(
      "file",
      new File(
        [
          await sharp({ create: { width: 8, height: 8, channels: 3, background: "#fff" } })
            .jpeg()
            .toBuffer(),
        ],
        "a.jpg",
      ),
    );
    const ok = await call(t.app, "POST", "/api/images", { form: jpeg });
    expect(ok.status).toBe(200);
    const { imageId } = (await ok.json()) as { imageId: string };
    const served = await call(t.app, "GET", `/api/images/${imageId}`);
    expect(served.headers.get("content-type")).toBe("image/jpeg");
  });

  test("容量の上限を超えたら 413、ファイルがなければ 400", async () => {
    await call(t.app, "PUT", "/api/staff/settings", {
      json: {
        price: 300,
        maxQuantityPerOrder: 1,
        maxPendingPerDevice: 2,
        printMaxWaitSeconds: 120,
        orderNumberDigits: 3,
        imageMaxBytes: 10,
      },
    });
    const big = new FormData();
    big.set("file", new File([encodePng(8, 8, new Uint8Array(192))], "big.png"));
    const tooBig = await call(t.app, "POST", "/api/images", { form: big });
    expect(tooBig.status).toBe(413);
    expect(await errorCode(tooBig)).toBe("PAYLOAD_TOO_LARGE");

    const none = await call(t.app, "POST", "/api/images", { form: new FormData() });
    expect(none.status).toBe(400);
  });

  test("存在しない画像は 404。パスを書き換える ID は 400", async () => {
    const missing = await call(t.app, "GET", "/api/images/01HZX3V5Q8N4M6T2B9C7D1E0FA");
    expect(missing.status).toBe(404);
    const traversal = await call(t.app, "GET", "/api/images/..%2F..%2Fapp.db");
    expect(traversal.status).toBe(400);
  });

  test("サンプル画像を配信できる", async () => {
    const res = await call(t.app, "GET", `/api/images/${sampleImageIds.smiley}`);
    expect(res.status).toBe(200);
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(new Uint8Array(await res.arrayBuffer()).subarray(1, 4)).toEqual(
      new Uint8Array([0x50, 0x4e, 0x47]),
    );
  });
});

describe("SSE", () => {
  test("スタッフ向けは、注文の変化と印刷待ちの変化を受け取る", async () => {
    const sse = await openSse(t.app, "/api/staff/events");
    transitionOrder(t.db, { orderId: t.orderId("waiting"), to: "paid", actor: "staff" });
    t.events.poll();

    const received = await sse.readMore((text) => text.includes("queue.updated"));
    await sse.close();
    expect(received).toContain("event: order.updated");
    expect(received).toContain(`"orderId":"${t.orderId("waiting")}"`);
    expect(received).toContain(`"status":"paid"`);
    expect(received).toContain("event: queue.updated");
  });

  test("来場者向けは、自分の注文の変化だけを受け取る", async () => {
    const sse = await openSse(t.app, `/api/events/orders/${t.orderId("waiting")}`);
    transitionOrder(t.db, { orderId: t.orderId("waitingFromArchive"), to: "paid", actor: "staff" });
    transitionOrder(t.db, { orderId: t.orderId("waiting"), to: "paid", actor: "staff" });
    t.events.poll();

    const received = await sse.readMore((text) => text.includes(t.orderId("waiting")));
    await sse.close();
    expect(received).toContain(t.orderId("waiting"));
    expect(received).not.toContain(t.orderId("waitingFromArchive"));
    expect(received).not.toContain("queue.updated");
  });

  test("モニター向けは、呼び出し一覧の変化だけを受け取り、注文 ID を含まない", async () => {
    const sse = await openSse(t.app, "/api/monitor/events");
    transitionOrder(t.db, { orderId: t.orderId("assembling"), to: "ready", actor: "staff" });
    t.events.poll();

    const received = await sse.readMore((text) => text.includes("monitor.updated"));
    await sse.close();
    expect(received).toContain("event: monitor.updated");
    expect(received).not.toContain("order.updated");
    expect(received).not.toContain(t.orderId("assembling"));
  });

  test("接続する前の変化は、あとから再送されない（画面は接続時に取り直す）", async () => {
    transitionOrder(t.db, { orderId: t.orderId("waiting"), to: "paid", actor: "staff" });
    // 購読者がいない間に、先に配信を済ませる
    t.events.poll();
    const sse = await openSse(t.app, "/api/staff/events");
    t.events.poll();
    const received = await sse.readMore((text) => text.includes("order.updated"), 300);
    await sse.close();
    expect(received).not.toContain("order.updated");
  });
});

describe("疎通", () => {
  test("/api/health は、契約の外の疎通用の口", async () => {
    const res = await call(t.app, "GET", "/api/health");
    expect(await res.json()).toEqual({ status: "ok", sseConnections: 0 });
  });
});
