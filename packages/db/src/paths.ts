import { existsSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";

/** リポジトリのルート（turbo.json のある場所）を、上にたどって探す */
export function findRepoRoot(startDir: string = import.meta.dir): string {
  let dir = resolve(startDir);
  for (;;) {
    if (existsSync(join(dir, "turbo.json"))) return dir;
    const parent = dirname(dir);
    if (parent === dir)
      throw new Error("リポジトリのルート（turbo.json のある場所）が見つかりません");
    dir = parent;
  }
}

/**
 * データ置き場（DB・画像・生成 PDF）。環境変数 DATA_DIR で変えられる。
 * 相対パスは、実行した場所ではなくリポジトリのルートから数える
 * （パッケージごとに実行場所が違っても、全プロセスが同じ場所を指すようにするため）
 */
export function resolveDataDir(env: Record<string, string | undefined> = process.env): string {
  const configured = env.DATA_DIR ?? "./data";
  return isAbsolute(configured) ? configured : resolve(findRepoRoot(), configured);
}

export const databasePath = (dataDir: string): string => join(dataDir, "app.db");
export const imagesDir = (dataDir: string): string => join(dataDir, "images");
export const sheetsDir = (dataDir: string): string => join(dataDir, "sheets");
