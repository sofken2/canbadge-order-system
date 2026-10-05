// `bun run db:reset` の受け口。DB を作り直して、サンプルデータを入れる。
// データ置き場は環境変数 DATA_DIR（既定は、リポジトリ直下の data/）。
// 本物の注文が入っている DB は、--force（`bun run db:reset:force`）でないと消さない
import { resolveDataDir } from "@canbadge/db";
import { resetAndSeed } from "./reset-database";

const dataDir = resolveDataDir();
const summary = resetAndSeed({ dataDir, force: process.argv.includes("--force") });

const statuses = Object.values(summary.orders).map((order) => order.status);
console.log(`サンプルデータを作りました: ${dataDir}`);
console.log(
  `  営業日 ${summary.businessDate}、注文 ${statuses.length} 件、印刷シート ${summary.sheets} 枚、アーカイブ作品 ${summary.archiveEntries} 件`,
);
