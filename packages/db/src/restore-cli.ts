// バックアップから、データ置き場を復旧する。api と print-worker を止めてから実行する。
//
//   bun run restore <バックアップの置き場所、またはスナップショットのフォルダ> [--force]
//
// 置き場所を渡すと、完成している最新のスナップショットを使う。
// 復旧先に DB があるときは、--force を付けると、退避してから置き換える（消さない）。
import { restoreData } from "./backup";
import { resolveDataDir } from "./paths";

const args = process.argv.slice(2);
const force = args.includes("--force");
const from = args.find((arg) => !arg.startsWith("--"));
if (!from) {
  console.error(
    "使い方: bun run restore <バックアップの置き場所、またはスナップショットのフォルダ> [--force]",
  );
  process.exit(1);
}

try {
  const result = restoreData({ from, dataDir: resolveDataDir(), force });
  console.log(`復旧しました: ${result.snapshotDir}`);
  console.log(`画像を ${result.imagesCopied} 件、復旧しました`);
  if (result.movedAside) console.log(`もとの DB は退避しました: ${result.movedAside}`);
} catch (error) {
  console.error(`復旧に失敗しました: ${(error as Error).message}`);
  process.exit(1);
}
