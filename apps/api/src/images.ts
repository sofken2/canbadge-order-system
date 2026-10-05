import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { imagesDir, newId } from "@canbadge/db";
import { ApiException } from "./errors";

// 画像の保存と配信の最小限。容量・形式の本格的な検証、サムネイル、期限切れの削除は A02 で行う。
// ファイル名は、利用者の入力ではなく、サーバーが作る ID にする（パスの書き換えを防ぐため）。

type Format = { extension: "png" | "jpg"; contentType: string };

const png: Format = { extension: "png", contentType: "image/png" };
const jpeg: Format = { extension: "jpg", contentType: "image/jpeg" };

/** ファイルの中身（先頭のバイト）で形式を判定する。拡張子や申告された種類は信用しない */
export function detectFormat(bytes: Uint8Array): Format | undefined {
  const startsWith = (signature: number[]) => signature.every((b, i) => bytes[i] === b);
  if (startsWith([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return png;
  if (startsWith([0xff, 0xd8, 0xff])) return jpeg;
  return undefined;
}

/** アップロードされた画像を保存し、画像 ID を返す */
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
  const id = newId();
  mkdirSync(imagesDir(dataDir), { recursive: true });
  await Bun.write(join(imagesDir(dataDir), `${id}.${format.extension}`), bytes);
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
