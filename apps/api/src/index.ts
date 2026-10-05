import { databasePath, openDatabase, resolveDataDir } from "@canbadge/db";
import { createApp } from "./app";
import { createEventHub } from "./events";

const port = Number(process.env.API_PORT ?? 3002);
const dataDir = resolveDataDir();

// DB がなければ、空の DB を作る（サンプルデータは `bun run db:reset` で入れる）
const db = openDatabase({ path: databasePath(dataDir) });
const events = createEventHub(db, { intervalMs: Number(process.env.SSE_POLL_MS ?? 2000) });

const app = createApp({
  db,
  dataDir,
  events,
  // スタッフ認証（A05）ができるまでは、公開経路（Cloudflare 経由）からスタッフ用の API を使えなくする
  allowPublicStaff: process.env.ALLOW_UNAUTHENTICATED_STAFF === "1",
});

console.log(`api: http://localhost:${port}（データ置き場: ${dataDir}）`);

// default export にすると `bun --watch` の再起動でポートを掴み直してくれる。
// SSE の接続は長く開いたままなので、Bun の接続の待ち時間（既定 10 秒）を止める
export default { port, fetch: app.fetch, idleTimeout: 0 };
