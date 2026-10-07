import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, readdirSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { imagesDir, setAcceptance } from "@canbadge/db";
import sharp from "sharp";
import { cleanupImages, ORPHAN_GRACE_MS } from "./images";
import { call, createTestApp, type TestApp } from "./test-helpers";

// 画像の検証・サムネイル・掃除（A02）。

let t: TestApp | undefined;
afterEach(async () => {
  await t?.close();
  t = undefined;
});

const app = (): TestApp => {
  t = createTestApp();
  return t;
};

/** 本物の画像（sharp で作る）。ノイズなので、PNG は大きく、縮めたサムネイルは、元より小さくなる */
async function photo(width: number, height: number, format: "png" | "jpeg" = "png") {
  const noise = Buffer.alloc(width * height * 3);
  // 同じ並びが続くと、PNG が小さくなりすぎるので、再現できる擬似乱数で埋める
  let seed = 12345;
  for (let i = 0; i < noise.length; i++) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    noise[i] = seed >> 16;
  }
  const image = sharp(noise, { raw: { width, height, channels: 3 } });
  return format === "png" ? image.png().toBuffer() : image.jpeg().toBuffer();
}

async function upload(
  test: TestApp,
  bytes: Uint8Array,
  name = "a.png",
  headers: Record<string, string> = {},
) {
  const form = new FormData();
  form.set("file", new File([bytes as Uint8Array<ArrayBuffer>], name));
  return call(test.app, "POST", "/api/images", { form, headers });
}

const idOf = async (res: Response) => ((await res.json()) as { imageId: string }).imageId;

const orderBody = (imageId: string) => ({
  imageId,
  editorData: { version: 1 },
  quantity: 1,
  turnstileToken: "tok",
  rightsConsent: true,
});

/** 注文に使う（失効していない注文のデザインになる） */
async function order(test: TestApp, imageId: string, ip: string) {
  return call(test.app, "POST", "/api/orders", {
    json: orderBody(imageId),
    headers: { "cf-connecting-ip": ip },
  });
}

const OLD = ORPHAN_GRACE_MS + 60_000;

/** 画像ファイルの更新時刻を、いまから ago（ms）前にする（アップロードから、時間がたったことにする） */
function age(test: TestApp, imageId: string, ago: number) {
  const dir = imagesDir(test.dir);
  const file = readdirSync(dir).find((name) => name.startsWith(imageId));
  if (!file) throw new Error("画像がない");
  const when = new Date(Date.now() - ago);
  utimesSync(join(dir, file), when, when);
}

const thumbOf = (test: TestApp, imageId: string) =>
  join(imagesDir(test.dir), "thumbs", `${imageId}.webp`);

describe("画像の検証", () => {
  test("中身が画像として読めない（先頭だけ PNG・JPEG の壊れたファイル）は、415 で断る", async () => {
    const test = app();
    const brokenPng = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
    const brokenJpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0]);
    const before = readdirSync(imagesDir(test.dir)).sort();
    for (const bytes of [brokenPng, brokenJpeg]) {
      const res = await upload(test, bytes);
      expect(res.status).toBe(415);
    }
    // 断った画像は、保存されない
    expect(readdirSync(imagesDir(test.dir)).sort()).toEqual(before);
  });

  test("途中で切れた画像は、断る", async () => {
    const test = app();
    const whole = await photo(64, 64);
    const res = await upload(test, whole.subarray(0, Math.floor(whole.length / 2)));
    expect(res.status).toBe(415);
  });

  test("巨大な画素数の画像（小さなファイルが、展開すると巨大になる）は、断る", async () => {
    const test = app();
    // 単色の PNG は、とても小さいファイルになるが、読み込むと 5600 万画素
    const bomb = await sharp({
      create: { width: 7500, height: 7500, channels: 3, background: "#fff" },
    })
      .png({ compressionLevel: 9 })
      .toBuffer();
    expect(bomb.length).toBeLessThan(1_000_000);
    const res = await upload(test, bomb);
    expect(res.status).toBe(415);
  });

  test("申告された種類・拡張子ではなく、中身で判定する（JPEG を .png と名乗っても、受け付ける）", async () => {
    const test = app();
    const res = await upload(test, await photo(40, 30, "jpeg"), "実は.png");
    expect(res.status).toBe(200);
    const served = await call(test.app, "GET", `/api/images/${await idOf(res)}`);
    expect(served.headers.get("content-type")).toBe("image/jpeg");
  });
});

describe("サムネイル", () => {
  test("?size=thumb は、長辺 256px 以内の WebP で、元の画像より小さい。元の画像は、そのまま", async () => {
    const test = app();
    const bytes = await photo(800, 600);
    const imageId = await idOf(await upload(test, bytes));

    const thumb = await call(test.app, "GET", `/api/images/${imageId}?size=thumb`);
    expect(thumb.status).toBe(200);
    expect(thumb.headers.get("content-type")).toBe("image/webp");
    expect(thumb.headers.get("x-content-type-options")).toBe("nosniff");
    const thumbBytes = new Uint8Array(await thumb.arrayBuffer());
    const meta = await sharp(thumbBytes).metadata();
    expect([meta.format, meta.width, meta.height]).toEqual(["webp", 256, 192]);
    expect(thumbBytes.length).toBeLessThan(bytes.length);

    const original = await call(test.app, "GET", `/api/images/${imageId}`);
    expect(original.headers.get("content-type")).toBe("image/png");
    expect(new Uint8Array(await original.arrayBuffer())).toEqual(new Uint8Array(bytes));
  });

  test("小さな画像は、拡大しない", async () => {
    const test = app();
    const imageId = await idOf(await upload(test, await photo(100, 50)));
    const thumb = await call(test.app, "GET", `/api/images/${imageId}?size=thumb`);
    const meta = await sharp(new Uint8Array(await thumb.arrayBuffer())).metadata();
    expect([meta.width, meta.height]).toEqual([100, 50]);
  });

  test("透明な PNG は、サムネイルでも、透明が残る", async () => {
    const test = app();
    const clear = await sharp({
      create: { width: 64, height: 64, channels: 4, background: { r: 255, g: 0, b: 0, alpha: 0 } },
    })
      .png()
      .toBuffer();
    const imageId = await idOf(await upload(test, clear));
    const thumb = await call(test.app, "GET", `/api/images/${imageId}?size=thumb`);
    const meta = await sharp(new Uint8Array(await thumb.arrayBuffer())).metadata();
    expect(meta.hasAlpha).toBe(true);
  });

  test("アップロードのときに作られる。なければ、配信のときに作る（古いデータ・作成の失敗に備える）", async () => {
    const test = app();
    const imageId = await idOf(await upload(test, await photo(300, 300)));
    expect(existsSync(thumbOf(test, imageId))).toBe(true);

    // 消しても、取りに来たときに、作り直す。同時に何枚来ても、壊れない
    cleanupThumbs(test, imageId);
    expect(existsSync(thumbOf(test, imageId))).toBe(false);
    const responses = await Promise.all(
      Array.from({ length: 5 }, () => call(test.app, "GET", `/api/images/${imageId}?size=thumb`)),
    );
    for (const res of responses) {
      expect(res.headers.get("content-type")).toBe("image/webp");
      expect((await sharp(new Uint8Array(await res.arrayBuffer())).metadata()).width).toBe(256);
    }
    expect(existsSync(thumbOf(test, imageId))).toBe(true);
    // 書きかけの一時ファイルが、残らない
    expect(
      readdirSync(join(imagesDir(test.dir), "thumbs")).filter((n) => n.endsWith(".tmp")),
    ).toEqual([]);
  });

  test("存在しない画像は 404（サムネイルでも）", async () => {
    const test = app();
    const res = await call(test.app, "GET", "/api/images/01HZX3V5Q8N4M6T2B9C7D1E0FA?size=thumb");
    expect(res.status).toBe(404);
  });

  test("画像は、変わらないので、ブラウザに覚えさせる（共有の置き場には、置かせない）", async () => {
    const test = app();
    const imageId = await idOf(await upload(test, await photo(30, 30)));
    for (const path of [`/api/images/${imageId}`, `/api/images/${imageId}?size=thumb`]) {
      const res = await call(test.app, "GET", path);
      expect(res.headers.get("cache-control")).toBe("private, max-age=3600");
    }
  });
});

function cleanupThumbs(test: TestApp, imageId: string) {
  // テスト用に、サムネイルだけを消す
  const path = thumbOf(test, imageId);
  if (existsSync(path)) rmSync(path);
}

describe("使われない画像の掃除", () => {
  test("15 分たっても、注文に使われない画像は消える。サムネイルも、いっしょに消える", async () => {
    const test = app();
    const imageId = await idOf(await upload(test, await photo(50, 50)));
    age(test, imageId, OLD);

    const result = cleanupImages(test.db, test.dir);
    expect(result).toEqual({ deletedImages: 1, deletedThumbnails: 1 });
    const res = await call(test.app, "GET", `/api/images/${imageId}`);
    expect(res.status).toBe(404);
    expect(existsSync(thumbOf(test, imageId))).toBe(false);
  });

  test("15 分たっていない画像は、使われていなくても、消えない（エディタで作業している間）", async () => {
    const test = app();
    const imageId = await idOf(await upload(test, await photo(50, 50)));
    age(test, imageId, ORPHAN_GRACE_MS - 60_000);
    expect(cleanupImages(test.db, test.dir)).toEqual({ deletedImages: 0, deletedThumbnails: 0 });
    expect((await call(test.app, "GET", `/api/images/${imageId}`)).status).toBe(200);
  });

  test("注文に使われた画像は、時間がたっても、消えない", async () => {
    const test = app();
    const imageId = await idOf(await upload(test, await photo(50, 50)));
    expect((await order(test, imageId, "198.51.100.1")).status).toBe(200);
    age(test, imageId, OLD * 100);
    expect(cleanupImages(test.db, test.dir).deletedImages).toBe(0);
    expect((await call(test.app, "GET", `/api/images/${imageId}`)).status).toBe(200);
  });

  test("支払い済みなど、失効していない注文の画像は、消えない。失効した注文の画像は、消える", async () => {
    const test = app();
    // 失効する注文（支払い待ちのまま、受付終了）
    const expiring = await idOf(await upload(test, await photo(50, 50)));
    expect((await order(test, expiring, "198.51.100.2")).status).toBe(200);
    // 失効しない注文（支払い済み）
    const paid = await idOf(await upload(test, await photo(50, 50)));
    const created = await order(test, paid, "198.51.100.3");
    const { orderId } = (await created.json()) as { orderId: string };
    expect((await call(test.app, "POST", `/api/staff/orders/${orderId}/pay`)).status).toBe(200);

    // 受付を終えると、支払い待ちの注文が失効する（db の遷移）
    setAcceptance(test.db, { acceptance: "closed", actor: "staff" });
    age(test, expiring, OLD);
    age(test, paid, OLD);

    const result = cleanupImages(test.db, test.dir);
    expect(result.deletedImages).toBe(1);
    expect((await call(test.app, "GET", `/api/images/${expiring}`)).status).toBe(404);
    expect((await call(test.app, "GET", `/api/images/${paid}`)).status).toBe(200);
  });

  test("失効した注文と、有効な注文が、同じ画像を使っているなら、消えない", async () => {
    const test = app();
    const shared = await idOf(await upload(test, await photo(50, 50)));
    expect((await order(test, shared, "198.51.100.4")).status).toBe(200);
    const second = await order(test, shared, "198.51.100.5");
    const { orderId } = (await second.json()) as { orderId: string };
    await call(test.app, "POST", `/api/staff/orders/${orderId}/pay`);
    // 1 件目だけ、失効させたいが、受付終了は、支払い待ちを全部失効させる。そこで、支払い済みの方だけが、残る
    setAcceptance(test.db, { acceptance: "closed", actor: "staff" });
    age(test, shared, OLD);
    expect(cleanupImages(test.db, test.dir).deletedImages).toBe(0);
    expect((await call(test.app, "GET", `/api/images/${shared}`)).status).toBe(200);
  });

  test("サンプルデータ（印刷待ちなどの注文）の画像は、消えない", async () => {
    const test = app();
    const dir = imagesDir(test.dir);
    const before = readdirSync(dir).sort();
    for (const file of before) {
      if (file === "thumbs") continue;
      const old = new Date(Date.now() - OLD);
      utimesSync(join(dir, file), old, old);
    }
    const result = cleanupImages(test.db, test.dir);
    // 失効したサンプルの注文があれば、その画像だけが消える。有効な注文の画像は、すべて残る
    const remaining = new Set(readdirSync(dir));
    expect(before.length - remaining.size).toBe(result.deletedImages);
    for (const name of ["paid", "printed", "assembling", "ready", "picked_up"]) {
      const orderRow = test.summary.orders[name];
      if (!orderRow) continue;
      const item = test.db.sqlite
        .query(
          "SELECT d.image_path AS p FROM order_items oi JOIN designs d ON d.id = oi.design_id WHERE oi.order_id = ?",
        )
        .get(orderRow.orderId) as { p: string } | null;
      if (item) expect(remaining.has(item.p.replace("images/", ""))).toBe(true);
    }
  });

  test("知らない名前のファイルは、触らない。元の画像のないサムネイルは、消える", async () => {
    const test = app();
    const dir = imagesDir(test.dir);
    const stray = join(dir, "memo.txt");
    writeFileSync(stray, "手で置いたメモ");
    const old = new Date(Date.now() - OLD);
    utimesSync(stray, old, old);
    const orphanThumb = join(dir, "thumbs", "01HZX3V5Q8N4M6T2B9C7D1E0FA.webp");
    await Bun.write(orphanThumb, "x");

    const result = cleanupImages(test.db, test.dir);
    expect(existsSync(stray)).toBe(true);
    expect(existsSync(orphanThumb)).toBe(false);
    expect(result.deletedThumbnails).toBeGreaterThanOrEqual(1);
  });

  test("画像の置き場がなくても、落ちない", () => {
    const test = app();
    expect(cleanupImages(test.db, join(test.dir, "ない場所"))).toEqual({
      deletedImages: 0,
      deletedThumbnails: 0,
    });
  });

  test("掃除で画像が消えたあとの注文は、「もう一度アップロードしてください」と断る（注文は作られない）", async () => {
    const test = app();
    const imageId = await idOf(await upload(test, await photo(50, 50)));
    age(test, imageId, OLD);
    cleanupImages(test.db, test.dir);
    const res = await order(test, imageId, "198.51.100.6");
    expect(res.status).toBe(400);
    expect(JSON.stringify(await res.json())).toContain("もう一度アップロード");
  });
});
