// マイグレーションを、別プロセスから同時に行うテスト用の実行ファイル（connection.test.ts が起動する）。
// 使い方: bun run migrate-worker.ts <DB ファイル>
import { openDatabase } from "./connection";

const [path] = process.argv.slice(2);
if (!path) throw new Error("使い方: migrate-worker <DB ファイル>");
openDatabase({ path }).close();
