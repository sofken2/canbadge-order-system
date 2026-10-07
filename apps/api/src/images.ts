import {
  existsSync,
  mkdirSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  unlinkSync,
} from "node:fs";
import { join } from "node:path";
import { type Database, imagesDir, listImagePathsInUse, newId } from "@canbadge/db";
import sharp from "sharp";
import { ApiException } from "./errors";

// 画像の保存・検証・サムネイル・掃除（A02）。
// ファイル名は、利用者の入力ではなく、サーバーが作る ID にする（パスの書き換えを防ぐため）。
// 形式は、拡張子や申告された種類ではなく、ファイルの中身で判定する。

type Format = { extension: "png" | "jpg"; contentType: string };

const png: Format = { extension: "png", contentType: "image/png" };
const jpeg: Format = { extension: "jpg", contentType: "image/jpeg" };

/**
 * 読み込んでよい画像の大きさ（画素数）。小さなファイルが、展開すると巨大になる画像（画像爆弾）で、
 * 処理 PC のメモリを使い切られないようにする。スマホの写真（約 1200 万画素）が、余裕で通る大きさ
 */
const MAX_PIXELS = 50_000_000;

/** サムネイルの長辺（px）。スタッフ画面の一覧で使う。高精細の画面でも、十分な大きさ */
const THUMBNAIL_SIZE = 256;

/** 注文に使われない画像を、消すまでの猶予。エディタで作業している間に、消えないようにする（spec.md 13.3） */
export const ORPHAN_GRACE_MS = 15 * 60 * 1000;

const THUMBNAIL_CONTENT_TYPE = "image/webp";
const thumbnailsDir = (dataDir: string) => join(imagesDir(dataDir), "thumbs");
const thumbnailPath = (dataDir: string, imageId: string) =>
  join(thumbnailsDir(dataDir), `${imageId}.webp`);

/** ファイルの中身（先頭のバイト）で形式を判定する。拡張子や申告された種類は信用しない */
export function detectFormat(bytes: Uint8Array): Format | undefined {
  const startsWith = (signature: number[]) => signature.every((b, i) => bytes[i] === b);
  if (startsWith([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return png;
  if (startsWith([0xff, 0xd8, 0xff])) return jpeg;
  return undefined;
}

const decoder = (bytes: Uint8Array) => sharp(bytes, { limitInputPixels: MAX_PIXELS });

/** 先頭のバイトだけでなく、画像として最後まで読めて、大きさが妥当かを確かめる（壊れた画像・画像爆弾を断る） */
async function assertDecodable(bytes: Uint8Array, format: Format): Promise<void> {
  try {
    const meta = await decoder(bytes).metadata();
    const expected = format === png ? "png" : "jpeg";
    if (meta.format !== expected || !meta.width || !meta.height) throw new Error("形式の不一致");
    // 先頭だけ正しい壊れた画像は、実際に読み込んでみないと分からない
    await decoder(bytes).resize(1, 1, { fit: "inside" }).raw().toBuffer();
  } catch {
    throw new ApiException(
      "UNSUPPORTED_MEDIA_TYPE",
      "この画像は読み込めませんでした。別の PNG か JPEG の画像を選んでください",
    );
  }
}

/** 同じ画像のサムネイルを、同時に作らない（一覧の画面が、同時に何枚も取りに来るため） */
const inFlight = new Map<string, Promise<string | undefined>>();

/**
 * サムネイルを作って保存し、そのパスを返す。作れなければ undefined（呼び出し側は、元の画像で代える）。
 * 向き（EXIF）は、サムネイルでは反映する。拡大はしない。透明は、WebP で残る
 */
function createThumbnail(
  dataDir: string,
  imageId: string,
  source: Uint8Array | string,
): Promise<string | undefined> {
  const target = thumbnailPath(dataDir, imageId);
  const running = inFlight.get(target);
  if (running) return running;

  const job = (async () => {
    try {
      mkdirSync(thumbnailsDir(dataDir), { recursive: true });
      const output = await sharp(source, { limitInputPixels: MAX_PIXELS })
        .rotate()
        .resize(THUMBNAIL_SIZE, THUMBNAIL_SIZE, { fit: "inside", withoutEnlargement: true })
        .webp({ quality: 80 })
        .toBuffer();
      // 書き込み途中のファイルを、配信しない（一時名で書いてから置き換える）
      const temporary = `${target}.${newId()}.tmp`;
      await Bun.write(temporary, output);
      renameSync(temporary, target);
      return target;
    } catch (error) {
      console.warn(`api: サムネイルを作れませんでした（${imageId}）`, error);
      return undefined;
    } finally {
      inFlight.delete(target);
    }
  })();
  inFlight.set(target, job);
  return job;
}

/** アップロードされた画像を検証して保存し、画像 ID を返す */
export async function saveUploadedImage(
  dataDir: string,
  file: File,
  maxBytes: number,
): Promise<string> {
  if (file.size > maxBytes) {
    throw new ApiException(
      "PAYLOAD_TOO_LARGE",
      `画像が大きすぎます（${Math.floor(maxBytes / 1024 / 1024)}MB まで）`,
    );
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  const format = detectFormat(bytes);
  if (!format) {
    throw new ApiException("UNSUPPORTED_MEDIA_TYPE", "PNG か JPEG の画像を選んでください");
  }
  await assertDecodable(bytes, format);

  const id = newId();
  mkdirSync(imagesDir(dataDir), { recursive: true });
  await Bun.write(join(imagesDir(dataDir), `${id}.${format.extension}`), bytes);
  // 一覧の画面が、すぐに取りに来るので、ここで作っておく（失敗しても、配信のときに、もう一度作る）
  await createThumbnail(dataDir, id, bytes);
  return id;
}

/** 画像 ID から、保存されているファイルを探す。ID は ULID に検証済みなので、パスは書き換えられない */
export function findImage(
  dataDir: string,
  imageId: string,
): { path: string; extension: string; contentType: string } | undefined {
  for (const format of [png, jpeg]) {
    const path = join(imagesDir(dataDir), `${imageId}.${format.extension}`);
    if (existsSync(path))
      return { path, extension: format.extension, contentType: format.contentType };
  }
  return undefined;
}

/**
 * サムネイルを返す。なければ作る。どうしても作れなければ、元の画像を返す（画面を壊さない）
 */
export async function findThumbnail(
  dataDir: string,
  imageId: string,
): Promise<{ path: string; contentType: string } | undefined> {
  const original = findImage(dataDir, imageId);
  if (!original) return undefined;
  const existing = thumbnailPath(dataDir, imageId);
  if (existsSync(existing)) return { path: existing, contentType: THUMBNAIL_CONTENT_TYPE };
  const created = await createThumbnail(dataDir, imageId, original.path);
  return created
    ? { path: created, contentType: THUMBNAIL_CONTENT_TYPE }
    : { path: original.path, contentType: original.contentType };
}

const IMAGE_FILE = /^([0-9A-Z]{26})\.(png|jpg)$/;
const THUMBNAIL_FILE = /^([0-9A-Z]{26})\.webp$/;

export type ImageCleanupResult = { deletedImages: number; deletedThumbnails: number };

/**
 * 使われない画像を消す。消すのは、次の画像（spec.md 13.3）。
 * - アップロードから 15 分たっても、どの注文にも使われない画像
 * - 失効した注文の画像（ほかの有効な注文が使っているものは、消さない）
 * あわせて、元の画像のないサムネイルも消す。
 *
 * **同期で行う**。使っている画像の一覧を読んでから消すまでの間に、await をはさまない。
 * api は 1 プロセスなので、その間に、注文（画像を使い始める）が割り込めない
 */
export function cleanupImages(
  db: Database,
  dataDir: string,
  options: { now?: number; graceMs?: number } = {},
): ImageCleanupResult {
  const now = options.now ?? Date.now();
  const graceMs = options.graceMs ?? ORPHAN_GRACE_MS;
  const result: ImageCleanupResult = { deletedImages: 0, deletedThumbnails: 0 };
  const dir = imagesDir(dataDir);
  if (!existsSync(dir)) return result;

  const inUse = listImagePathsInUse(db);
  const kept = new Set<string>();
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const match = IMAGE_FILE.exec(entry.name);
    // 知らない名前のファイルは、触らない
    if (!match?.[1]) continue;
    const path = join(dir, entry.name);
    const young = now - statSync(path).mtimeMs < graceMs;
    if (young || inUse.has(`images/${entry.name}`)) {
      kept.add(match[1]);
      continue;
    }
    unlinkSync(path);
    result.deletedImages += 1;
  }

  const thumbs = thumbnailsDir(dataDir);
  if (existsSync(thumbs)) {
    for (const entry of readdirSync(thumbs, { withFileTypes: true })) {
      if (!entry.isFile()) continue;
      const match = THUMBNAIL_FILE.exec(entry.name);
      if (!match?.[1] || kept.has(match[1])) continue;
      rmSync(join(thumbs, entry.name), { force: true });
      result.deletedThumbnails += 1;
    }
  }
  return result;
}
