import { afterEach, describe, expect, test } from "bun:test";
import { readdirSync, utimesSync } from "node:fs";
import { join } from "node:path";
import { imagesDir } from "@canbadge/db";
import { encodePng } from "@canbadge/fixtures";
import { apiErrorSchema } from "@canbadge/shared";
import { LIMITS } from "./abuse";
import { cleanupImages, ORPHAN_GRACE_MS } from "./images";
import { call, createTestApp, type TestApp } from "./test-helpers";
import type { TurnstileVerifier } from "./turnstile";

// アーカイブ（A04）：投稿・審査・公開・通報・作品からの注文・取り下げ。

let t: TestApp | undefined;
afterEach(async () => {
  await t?.close();
  t = undefined;
});
const app = (options: Parameters<typeof createTestApp>[0] = {}): TestApp => {
  t = createTestApp(options);
  return t;
};

const errorCode = async (res: Response) => apiErrorSchema.parse(await res.json()).error.code;
const json = async <T>(res: Response) => (await res.json()) as T;

/** 端末（匿名トークンの Cookie を持つ来場者）。最初に Cookie をくれるのは、api */
function visitor(test: TestApp, ip = "198.51.100.10") {
  let cookie = "";
  const send = async (
    method: string,
    path: string,
    options: { json?: unknown; form?: FormData } = {},
  ) => {
    const res = await call(test.app, method, path, {
      ...options,
      headers: { ...(cookie ? { cookie } : {}), "cf-connecting-ip": ip },
    });
    const set = res.headers.get("set-cookie");
    if (set) cookie = set.split(";")[0] ?? cookie;
    return res;
  };
  return { send, cookie: () => cookie };
}
type Visitor = ReturnType<typeof visitor>;

async function upload(v: Visitor): Promise<string> {
  const form = new FormData();
  form.set(
    "file",
    new File([encodePng(2, 2, new Uint8Array(12).fill(90))], "a.png", { type: "image/png" }),
  );
  return (await json<{ imageId: string }>(await v.send("POST", "/api/images", { form }))).imageId;
}

const consent = { selfMade: true, allowOthersToOrder: true };

async function post(v: Visitor, name = "たろう", imageId?: string) {
  const res = await v.send("POST", "/api/archive", {
    json: {
      imageId: imageId ?? (await upload(v)),
      editorData: { version: 1 },
      displayName: name,
      consent,
    },
  });
  return { res, entryId: res.ok ? (await json<{ entryId: string }>(res)).entryId : "" };
}

const staff = (test: TestApp, method: string, path: string) => call(test.app, method, path);
const approve = (test: TestApp, id: string) =>
  staff(test, "POST", `/api/staff/archive/${id}/approve`);

async function publish(test: TestApp, v: Visitor, name = "たろう") {
  const { entryId } = await post(v, name);
  expect((await approve(test, entryId)).status).toBe(200);
  return entryId;
}

/** 公開の一覧を、最後まで読んで、ID を新しい順に返す（サンプルデータの作品も、含まれる） */
async function publicIds(test: TestApp): Promise<string[]> {
  const ids: string[] = [];
  let before = "";
  for (let page = 0; page < 50; page++) {
    const res = await json<{ items: { id: string }[]; nextBefore: string | null }>(
      await call(test.app, "GET", `/api/archive?limit=100${before ? `&before=${before}` : ""}`),
    );
    ids.push(...res.items.map((i) => i.id));
    if (!res.nextBefore) break;
    before = res.nextBefore;
  }
  return ids;
}

const orderBody = { quantity: 1, turnstileToken: "tok", rightsConsent: true };

describe("投稿", () => {
  test("審査待ちで投稿され、自分の一覧に出る。公開の一覧には、まだ出ない", async () => {
    const test = app();
    const a = visitor(test);
    const { res, entryId } = await post(a, "はなこ");
    expect(res.status).toBe(200);

    const mine = await json<{ items: { id: string; status: string; displayName: string }[] }>(
      await a.send("GET", "/api/my/archive"),
    );
    expect(mine.items).toMatchObject([
      { id: entryId, status: "pending_review", displayName: "はなこ" },
    ]);

    expect(await publicIds(test)).not.toContain(entryId);
  });

  test("同意の 2 項目が、true でなければ、API が 400 で断る（欠けている・false・文字列の true）", async () => {
    const test = app();
    const a = visitor(test);
    const imageId = await upload(a);
    for (const bad of [
      { selfMade: false, allowOthersToOrder: true },
      { selfMade: true, allowOthersToOrder: false },
      { selfMade: true },
      { allowOthersToOrder: true },
      {},
      { selfMade: "true", allowOthersToOrder: "true" },
    ]) {
      const res = await a.send("POST", "/api/archive", {
        json: { imageId, editorData: { version: 1 }, displayName: "たろう", consent: bad },
      });
      expect({ bad, status: res.status }).toEqual({ bad, status: 400 });
    }
    // consent そのものがない
    const none = await a.send("POST", "/api/archive", {
      json: { imageId, editorData: { version: 1 }, displayName: "たろう" },
    });
    expect(none.status).toBe(400);
    expect(
      (await json<{ items: unknown[] }>(await a.send("GET", "/api/my/archive"))).items,
    ).toEqual([]);
  });

  test("表示名が空・長すぎるなら、400。画像がなければ、400（もう一度アップロード）", async () => {
    const test = app();
    const a = visitor(test);
    expect((await post(a, "   ")).res.status).toBe(400);
    expect((await post(a, "あ".repeat(21))).res.status).toBe(400);
    const missing = await post(a, "たろう", "01HZX3V5Q8N4M6T2B9C7D1E0FA");
    expect(missing.res.status).toBe(400);
  });

  test("同意の日時が記録される", async () => {
    const test = app();
    const a = visitor(test);
    const { entryId } = await post(a);
    const row = test.db.sqlite
      .query("SELECT consent FROM archive_entries WHERE id = ?")
      .get(entryId) as { consent: string };
    const recorded = JSON.parse(row.consent) as { selfMade: boolean; agreedAt: string };
    expect(recorded.selfMade).toBe(true);
    expect(recorded.agreedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  test("1 端末が持てる審査待ちは 3 件まで（4 件目は 429）。別の端末は、投稿できる", async () => {
    const test = app();
    const a = visitor(test);
    for (let i = 0; i < 3; i++) expect((await post(a)).res.status).toBe(200);
    const fourth = await post(a);
    expect(fourth.res.status).toBe(429);
    expect(await errorCode(fourth.res)).toBe("RATE_LIMITED");
    expect((await post(visitor(test, "198.51.100.77"))).res.status).toBe(200);
  });

  test("投稿の回数の制限（IP ごと。画像のアップロードと同じ枠）。別の IP には、影響しない", async () => {
    const test = app();
    const ip = "198.51.100.200";
    const imageId = await upload(visitor(test, ip));
    // 端末（Cookie）を変えながら、同じ IP から、投稿し続ける（端末ごとの審査待ちの上限には、当たらない）
    let limited = 0;
    for (let i = 0; i < LIMITS.uploads.limit + 5; i++) {
      const res = await post(visitor(test, ip), "x", imageId);
      if (res.res.status === 429) {
        limited++;
        break;
      }
    }
    expect(limited).toBe(1);
    expect((await post(visitor(test, "198.51.100.201"), "x", imageId)).res.status).toBe(200);
  });
});

describe("審査と公開", () => {
  test("承認すると、公開の一覧と詳細に出る。作者の匿名トークンは、どの応答にも含まれない", async () => {
    const test = app();
    const a = visitor(test);
    const entryId = await publish(test, a, "じろう");

    const listRes = await call(test.app, "GET", "/api/archive");
    const listText = await listRes.text();
    const list = JSON.parse(listText) as {
      items: { id: string; displayName: string; thumbnailUrl: string }[];
    };
    const mine = list.items.find((i) => i.id === entryId);
    expect(mine).toMatchObject({ displayName: "じろう" });
    expect(mine?.thumbnailUrl).toMatch(/^\/api\/images\/[0-9A-Z]{26}\?size=thumb$/);

    const detailText = await (await call(test.app, "GET", `/api/archive/${entryId}`)).text();
    const staffText = await (await staff(test, "GET", "/api/staff/archive")).text();
    const token = a.cookie().split("=")[1] ?? "";
    expect(token.length).toBeGreaterThan(16);
    for (const text of [listText, detailText, staffText]) {
      expect(text).not.toContain(token);
      expect(text).not.toContain("authorAnonToken");
      expect(text).not.toContain("anon");
    }
  });

  test("公開の一覧は、新しい順で、続き（nextBefore）を最後まで取れる。重複も、抜けもない", async () => {
    const test = app();
    const a = visitor(test);
    const ids: string[] = [];
    for (let i = 0; i < 4; i++) {
      ids.push(await publish(test, a, `作品${i}`));
      await Bun.sleep(3);
    }
    const all = await publicIds(test);
    const collected: string[] = [];
    let before = "";
    for (let page = 0; page < 20; page++) {
      const res = await json<{ items: { id: string }[]; nextBefore: string | null }>(
        await call(test.app, "GET", `/api/archive?limit=3${before ? `&before=${before}` : ""}`),
      );
      expect(res.items.length).toBeLessThanOrEqual(3);
      collected.push(...res.items.map((i) => i.id));
      if (!res.nextBefore) break;
      before = res.nextBefore;
    }
    expect(collected).toEqual(all);
    expect(new Set(collected).size).toBe(collected.length);
    // 自分の 4 点は、新しい順に並んでいる
    expect(collected.filter((id) => ids.includes(id))).toEqual([...ids].reverse());
  });

  test("審査待ち・却下の作品は、他の人には見えない（詳細も 404）。作者本人には、見える（isMine）", async () => {
    const test = app();
    const author = visitor(test);
    const other = visitor(test, "198.51.100.20");
    const { entryId: pending } = await post(author);
    const { entryId: rejected } = await post(author);
    await staff(test, "POST", `/api/staff/archive/${rejected}/reject`);

    for (const id of [pending, rejected]) {
      expect((await call(test.app, "GET", `/api/archive/${id}`)).status).toBe(404);
      expect((await other.send("GET", `/api/archive/${id}`)).status).toBe(404);
      const own = await author.send("GET", `/api/archive/${id}`);
      expect(own.status).toBe(200);
      expect(await json<{ isMine: boolean }>(own)).toMatchObject({ isMine: true });
    }
  });

  test("公開中の作品の詳細：大きい画像・編集データがあり、他人には isMine が false", async () => {
    const test = app();
    const author = visitor(test);
    const entryId = await publish(test, author);
    const other = await json<{
      isMine: boolean;
      imageUrl: string;
      editorData: unknown;
      status: string;
    }>(await call(test.app, "GET", `/api/archive/${entryId}`));
    expect(other).toMatchObject({ isMine: false, status: "public", editorData: { version: 1 } });
    expect(other.imageUrl).toMatch(/^\/api\/images\/[0-9A-Z]{26}$/);
    const mine = await json<{ isMine: boolean }>(
      await author.send("GET", `/api/archive/${entryId}`),
    );
    expect(mine.isMine).toBe(true);
  });

  test("遷移表にない操作は、409（承認済みをもう一度承認・却下のあとに承認・審査待ちを非公開）", async () => {
    const test = app();
    const a = visitor(test);
    const entryId = await publish(test, a);
    const again = await approve(test, entryId);
    expect(again.status).toBe(409);
    expect(await errorCode(again)).toBe("INVALID_TRANSITION");

    const { entryId: pending } = await post(a);
    expect((await staff(test, "POST", `/api/staff/archive/${pending}/hide`)).status).toBe(409);
    await staff(test, "POST", `/api/staff/archive/${pending}/reject`);
    expect((await approve(test, pending)).status).toBe(409);
    expect((await approve(test, "01HZX3V5Q8N4M6T2B9C7D1E0FA")).status).toBe(404);
  });

  test("スタッフの審査の一覧：状態で絞れる。却下・非公開にした作品も、一覧に残る", async () => {
    const test = app();
    const a = visitor(test);
    const pending = (await post(a)).entryId;
    const pub = await publish(test, a);
    const hidden = await publish(test, a);
    await staff(test, "POST", `/api/staff/archive/${hidden}/hide`);
    const mine = [pending, pub, hidden];

    const ids = async (query: string) =>
      (
        await json<{ items: { id: string }[] }>(
          await staff(test, "GET", `/api/staff/archive${query}`),
        )
      ).items
        .map((i) => i.id)
        .filter((id) => mine.includes(id));
    expect(await ids("?status=pending_review")).toEqual([pending]);
    expect(await ids("?status=public")).toEqual([pub]);
    expect(await ids("?status=hidden")).toEqual([hidden]);
    expect((await ids("")).sort()).toEqual([...mine].sort());
    // 審査では、大きい画像も見られる
    const first = (
      await json<{ items: { imageUrl: string }[] }>(await staff(test, "GET", "/api/staff/archive"))
    ).items[0];
    expect(first?.imageUrl).toMatch(/^\/api\/images\/[0-9A-Z]{26}$/);
  });
});

describe("取り下げ", () => {
  test("作者は、公開中の作品を取り下げられる。公開の一覧から消える", async () => {
    const test = app();
    const a = visitor(test);
    const entryId = await publish(test, a);
    expect(await publicIds(test)).toContain(entryId);
    const res = await a.send("POST", `/api/archive/${entryId}/withdraw`);
    expect(res.status).toBe(200);
    expect(await json<{ status: string }>(res)).toMatchObject({ status: "hidden" });
    expect(await publicIds(test)).not.toContain(entryId);
    // 取り下げたあとの作品を、また取り下げることはできない
    expect((await a.send("POST", `/api/archive/${entryId}/withdraw`)).status).toBe(409);
  });

  test("作者以外は、取り下げられない（404。作品があることも教えない）。Cookie がない端末も同じ", async () => {
    const test = app();
    const entryId = await publish(test, visitor(test));
    const other = visitor(test, "198.51.100.30");
    expect((await other.send("POST", `/api/archive/${entryId}/withdraw`)).status).toBe(404);
    expect((await call(test.app, "POST", `/api/archive/${entryId}/withdraw`)).status).toBe(404);
    expect((await call(test.app, "GET", `/api/archive/${entryId}`)).status).toBe(200);
  });

  test("審査待ちの作品は、作者でも、取り下げではなく（表にない遷移）、409", async () => {
    const test = app();
    const a = visitor(test);
    const { entryId } = await post(a);
    expect((await a.send("POST", `/api/archive/${entryId}/withdraw`)).status).toBe(409);
  });
});

describe("通報", () => {
  test("公開中の作品を通報でき、スタッフの一覧に、作品つきで出る。審査の一覧には、未対応の件数が出る", async () => {
    const test = app();
    const entryId = await publish(test, visitor(test));
    const reporter = visitor(test, "198.51.100.40");
    const res = await reporter.send("POST", `/api/archive/${entryId}/report`, {
      json: { reason: "他人の写真が写っています" },
    });
    expect(res.status).toBe(200);
    const { reportId } = await json<{ reportId: string }>(res);

    const reports = await json<{
      items: {
        id: string;
        status: string;
        reason: string;
        entry: { displayName: string; imageUrl: string };
      }[];
    }>(await staff(test, "GET", "/api/staff/archive/reports?status=open"));
    expect(reports.items.find((r) => r.id === reportId)).toMatchObject({
      status: "open",
      reason: "他人の写真が写っています",
      entry: { displayName: "たろう" },
    });
    const entries = await json<{ items: { id: string; openReportCount: number }[] }>(
      await staff(test, "GET", "/api/staff/archive"),
    );
    expect(entries.items.find((e) => e.id === entryId)?.openReportCount).toBe(1);

    expect(
      (await staff(test, "POST", `/api/staff/archive/reports/${reportId}/resolve`)).status,
    ).toBe(200);
    expect(
      (await staff(test, "POST", `/api/staff/archive/reports/${reportId}/resolve`)).status,
    ).toBe(409);
    const after = await json<{ items: { id: string }[] }>(
      await staff(test, "GET", "/api/staff/archive/reports?status=open"),
    );
    expect(after.items.map((r) => r.id)).not.toContain(reportId);
  });

  test("公開中でない作品・存在しない作品は、通報できない。理由が空なら 400", async () => {
    const test = app();
    const a = visitor(test);
    const { entryId: pending } = await post(a);
    const pub = await publish(test, a);
    expect(
      (await a.send("POST", `/api/archive/${pending}/report`, { json: { reason: "x" } })).status,
    ).toBe(404);
    expect(
      (
        await a.send("POST", "/api/archive/01HZX3V5Q8N4M6T2B9C7D1E0FA/report", {
          json: { reason: "x" },
        })
      ).status,
    ).toBe(404);
    expect(
      (await a.send("POST", `/api/archive/${pub}/report`, { json: { reason: "  " } })).status,
    ).toBe(400);
  });

  test("作品を非公開にすると、その作品への未対応の通報は、対応済みになる", async () => {
    const test = app();
    const entryId = await publish(test, visitor(test));
    const reported = await visitor(test, "198.51.100.41").send(
      "POST",
      `/api/archive/${entryId}/report`,
      { json: { reason: "x" } },
    );
    const { reportId } = await json<{ reportId: string }>(reported);
    const openIds = async () =>
      (
        await json<{ items: { id: string }[] }>(
          await staff(test, "GET", "/api/staff/archive/reports?status=open"),
        )
      ).items.map((r) => r.id);
    expect(await openIds()).toContain(reportId);
    await staff(test, "POST", `/api/staff/archive/${entryId}/hide`);
    expect(await openIds()).not.toContain(reportId);
  });
});

describe("作品からの注文", () => {
  test("公開中の作品を、コピーして注文できる。作者の表示名と、元作品への参照が残る", async () => {
    const test = app();
    const entryId = await publish(test, visitor(test), "さぶろう");
    const buyer = visitor(test, "198.51.100.50");
    const res = await buyer.send("POST", `/api/archive/${entryId}/order`, { json: orderBody });
    expect(res.status).toBe(200);
    const { orderId } = await json<{ orderId: string }>(res);

    const row = test.db.sqlite
      .query(
        `SELECT d.source_archive_entry_id AS source, o.status AS status
           FROM orders o JOIN order_items i ON i.order_id = o.id JOIN designs d ON d.id = i.design_id
          WHERE o.id = ?`,
      )
      .get(orderId) as { source: string; status: string };
    expect(row).toEqual({ source: entryId, status: "submitted" });
    // 買った人の端末の注文として、取れる
    expect((await buyer.send("GET", `/api/orders/${orderId}`)).status).toBe(200);
  });

  test("公開中でない作品（審査待ち・却下・非公開）・存在しない作品からは、注文できない。404", async () => {
    const test = app();
    const a = visitor(test);
    const buyer = visitor(test, "198.51.100.51");
    const { entryId: pending } = await post(a);
    const { entryId: rejected } = await post(a);
    await staff(test, "POST", `/api/staff/archive/${rejected}/reject`);
    const hidden = await publish(test, a);
    await staff(test, "POST", `/api/staff/archive/${hidden}/hide`);
    for (const id of [pending, rejected, hidden, "01HZX3V5Q8N4M6T2B9C7D1E0FA"]) {
      const res = await buyer.send("POST", `/api/archive/${id}/order`, { json: orderBody });
      expect({ id, status: res.status }).toEqual({ id, status: 404 });
    }
  });

  test("同意（rightsConsent）が true でなければ、400。個数が上限を超えれば、400", async () => {
    const test = app();
    const entryId = await publish(test, visitor(test));
    const buyer = visitor(test, "198.51.100.52");
    expect(
      (
        await buyer.send("POST", `/api/archive/${entryId}/order`, {
          json: { ...orderBody, rightsConsent: false },
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await buyer.send("POST", `/api/archive/${entryId}/order`, {
          json: { ...orderBody, quantity: 99 },
        })
      ).status,
    ).toBe(400);
  });

  test("受付が止まっているとき（ビジー）は、作品からも注文できない（503）", async () => {
    const test = app();
    const entryId = await publish(test, visitor(test));
    await call(test.app, "POST", "/api/staff/acceptance", { json: { acceptance: "busy" } });
    const res = await visitor(test, "198.51.100.53").send("POST", `/api/archive/${entryId}/order`, {
      json: orderBody,
    });
    expect(res.status).toBe(503);
    expect(await errorCode(res)).toBe("NOT_ACCEPTING");
  });

  test("端末あたりの支払い待ちの上限は、作品からの注文にも掛かる（通常の注文と合わせて数える）", async () => {
    const test = app();
    const entryId = await publish(test, visitor(test));
    const buyer = visitor(test, "198.51.100.54");
    const limit = (
      await json<{ maxPendingPerDevice: number }>(
        await call(test.app, "GET", "/api/staff/settings"),
      )
    ).maxPendingPerDevice;
    for (let i = 0; i < limit; i++) {
      expect(
        (await buyer.send("POST", `/api/archive/${entryId}/order`, { json: orderBody })).status,
      ).toBe(200);
    }
    const over = await buyer.send("POST", `/api/archive/${entryId}/order`, { json: orderBody });
    expect(over.status).toBe(429);
  });

  test("Turnstile は、作品からの注文でも、サーバーで検証される（通らなければ、注文は作られない）", async () => {
    const calls: string[] = [];
    const verifier: TurnstileVerifier = {
      verify: async (token) => {
        calls.push(token);
        return token === "good"
          ? { ok: true }
          : { ok: false, reason: "invalid-input-response", transient: false };
      },
    };
    const test = app({ turnstile: verifier });
    const entryId = await publish(test, visitor(test));
    const buyer = visitor(test, "198.51.100.55");
    const bad = await buyer.send("POST", `/api/archive/${entryId}/order`, {
      json: { ...orderBody, turnstileToken: "bad" },
    });
    expect(bad.status).toBe(400);
    const good = await buyer.send("POST", `/api/archive/${entryId}/order`, {
      json: { ...orderBody, turnstileToken: "good" },
    });
    expect(good.status).toBe(200);
    expect(calls).toEqual(["bad", "good"]);
  });

  test("Turnstile の確認の間に、作品が非公開になったら、注文は作られない（確認のあとに、もう一度、見る）", async () => {
    let entryId = "";
    let test: TestApp | undefined;
    const verifier: TurnstileVerifier = {
      verify: async () => {
        // 確認している最中に、スタッフが、作品を非公開にする
        await staff(test as TestApp, "POST", `/api/staff/archive/${entryId}/hide`);
        return { ok: true };
      },
    };
    test = app({ turnstile: verifier });
    entryId = await publish(test, visitor(test));
    const res = await visitor(test, "198.51.100.56").send("POST", `/api/archive/${entryId}/order`, {
      json: orderBody,
    });
    expect(res.status).toBe(404);
    // この作品をコピーした注文は、作られていない
    const copies = test.db.sqlite
      .query("SELECT count(*) AS n FROM designs WHERE source_archive_entry_id = ?")
      .get(entryId) as { n: number };
    expect(copies.n).toBe(0);
  });

  test("作品を非公開にすると、そのコピーの、支払い前の注文だけが止まる（支払い済みは、そのまま）。作者の取り下げでも同じ", async () => {
    const test = app();
    const author = visitor(test);
    const entryId = await publish(test, author);
    const order = async (ip: string) => {
      const res = await visitor(test, ip).send("POST", `/api/archive/${entryId}/order`, {
        json: orderBody,
      });
      return (await json<{ orderId: string }>(res)).orderId;
    };
    const waiting = await order("198.51.100.60");
    const paid = await order("198.51.100.61");
    expect((await call(test.app, "POST", `/api/staff/orders/${paid}/pay`)).status).toBe(200);

    expect((await author.send("POST", `/api/archive/${entryId}/withdraw`)).status).toBe(200);

    const status = async (id: string) =>
      (await json<{ status: string }>(await call(test.app, "GET", `/api/orders/${id}`))).status;
    expect(await status(waiting)).toBe("expired");
    expect(await status(paid)).toBe("paid");
  });

  test("止められた注文は、来場者の画面に、失効として伝わる（SSE の order.updated の元になる操作ログ）", async () => {
    const test = app();
    const entryId = await publish(test, visitor(test));
    const res = await visitor(test, "198.51.100.62").send("POST", `/api/archive/${entryId}/order`, {
      json: orderBody,
    });
    const { orderId } = await json<{ orderId: string }>(res);
    await staff(test, "POST", `/api/staff/archive/${entryId}/hide`);
    const row = test.db.sqlite
      .query(
        "SELECT actor, detail FROM audit_logs WHERE target_id = ? AND action = 'order.transition' ORDER BY seq DESC LIMIT 1",
      )
      .get(orderId) as { actor: string; detail: string };
    expect(row.actor).toBe("system");
    expect(JSON.parse(row.detail)).toMatchObject({ to: "expired", reason: "archive_hidden" });
  });
});

describe("画像の掃除との連動（A02）", () => {
  function age(test: TestApp, imageId: string, ago: number) {
    const dir = imagesDir(test.dir);
    const file = readdirSync(dir).find((name) => name.startsWith(imageId));
    if (!file) throw new Error("画像がない");
    const when = new Date(Date.now() - ago);
    utimesSync(join(dir, file), when, when);
  }
  const OLD = ORPHAN_GRACE_MS + 60_000;
  test("審査待ち・公開中の作品の画像は、時間がたっても、消えない。却下された作品の画像は、消える", async () => {
    const test = app();
    const a = visitor(test);
    const pendingImage = await upload(a);
    const rejectedImage = await upload(a);
    await post(a, "a", pendingImage);
    const { entryId: rejected } = await post(a, "b", rejectedImage);
    age(test, pendingImage, OLD);
    age(test, rejectedImage, OLD);

    expect(cleanupImages(test.db, test.dir).deletedImages).toBe(0);
    await staff(test, "POST", `/api/staff/archive/${rejected}/reject`);
    expect(cleanupImages(test.db, test.dir).deletedImages).toBe(1);
    expect((await call(test.app, "GET", `/api/images/${pendingImage}`)).status).toBe(200);
    expect((await call(test.app, "GET", `/api/images/${rejectedImage}`)).status).toBe(404);
  });

  test("作品を非公開にしても、コピーの注文（支払い済み）が生きている間は、その画像は、消えない", async () => {
    const test = app();
    const a = visitor(test);
    const imageId = await upload(a);
    const { entryId } = await post(a, "c", imageId);
    await approve(test, entryId);
    const res = await visitor(test, "198.51.100.70").send("POST", `/api/archive/${entryId}/order`, {
      json: orderBody,
    });
    const { orderId } = await json<{ orderId: string }>(res);
    await call(test.app, "POST", `/api/staff/orders/${orderId}/pay`);
    await staff(test, "POST", `/api/staff/archive/${entryId}/hide`);
    age(test, imageId, OLD);

    expect(cleanupImages(test.db, test.dir).deletedImages).toBe(0);
    expect((await call(test.app, "GET", `/api/images/${imageId}`)).status).toBe(200);
  });
});

describe("認証", () => {
  test("審査・通報の対応は、スタッフ用。公開経路（Cloudflare 経由・Access なし）からは、401。来場者向けは、開いている", async () => {
    const test = app({ remoteAddress: "127.0.0.1" });
    const viaCloudflare = { "cf-ray": "abc-NRT", "cf-connecting-ip": "203.0.113.9" };
    for (const [method, path] of [
      ["GET", "/api/staff/archive"],
      ["POST", "/api/staff/archive/01HZX3V5Q8N4M6T2B9C7D1E0FA/approve"],
      ["POST", "/api/staff/archive/01HZX3V5Q8N4M6T2B9C7D1E0FA/reject"],
      ["POST", "/api/staff/archive/01HZX3V5Q8N4M6T2B9C7D1E0FA/hide"],
      ["GET", "/api/staff/archive/reports"],
      ["POST", "/api/staff/archive/reports/01HZX3V5Q8N4M6T2B9C7D1E0FA/resolve"],
    ] as const) {
      const res = await call(test.app, method, path, { headers: viaCloudflare });
      expect({ path, status: res.status }).toEqual({ path, status: 401 });
    }
    expect((await call(test.app, "GET", "/api/archive", { headers: viaCloudflare })).status).toBe(
      200,
    );
  });
});
