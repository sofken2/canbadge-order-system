// 注文番号の採番を、別プロセスから同時に行うテスト用の実行ファイル（concurrency.test.ts が起動する）。
// 使い方: bun run numbering-worker.ts <DB ファイル> <作る注文の数>
import { openDatabase } from "./connection";
import { createOrder } from "./orders";

const [path, countText] = process.argv.slice(2);
if (!path || !countText) throw new Error("使い方: numbering-worker <DB ファイル> <注文の数>");

const db = openDatabase({ path, migrate: false });
for (let i = 0; i < Number(countText); i++) {
  createOrder(db, {
    imagePath: "images/sample.png",
    editorData: { version: 1 },
    quantity: 1,
    // 注文ごとに別の端末として扱う（端末あたりの支払い待ちの上限に、当たらないように）
    anonToken: `${"w".repeat(16)}${crypto.randomUUID().replaceAll("-", "")}`.slice(0, 48),
  });
}
db.close();
