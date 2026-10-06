import { databasePath, openDatabase, resolveDataDir } from "@canbadge/db";
import { getConnInfo } from "hono/bun";
import { accessConfigFromEnv, createAccessVerifier } from "./access";
import { createApp } from "./app";
import { createEventHub } from "./events";

const port = Number(process.env.API_PORT ?? 3002);
const dataDir = resolveDataDir();

// DB がなければ、空の DB を作る（サンプルデータは `bun run db:reset` で入れる）
const db = openDatabase({ path: databasePath(dataDir) });
const events = createEventHub(db, { intervalMs: Number(process.env.SSE_POLL_MS ?? 2000) });

const accessConfig = accessConfigFromEnv(process.env);
const allowPublicStaff = process.env.ALLOW_UNAUTHENTICATED_STAFF === "1";

const app = createApp({
  db,
  dataDir,
  events,
  // 開発用。本番では付けない（付けると、スタッフ認証なしで、公開経路からも使えてしまう）
  allowPublicStaff,
  // Cloudflare Access の JWT を検証する（A05）。未設定なら、Cloudflare 経由のスタッフ用は、すべて断る
  access: accessConfig ? createAccessVerifier(accessConfig) : undefined,
  remoteAddressOf: (c) => getConnInfo(c).remote.address,
});

if (allowPublicStaff) {
  console.warn(
    "api: 警告 ALLOW_UNAUTHENTICATED_STAFF=1 のため、スタッフ用の API が、認証なしで、どの経路からも使えます（開発用）",
  );
} else if (!accessConfig) {
  console.warn(
    "api: CF_ACCESS_TEAM_DOMAIN・CF_ACCESS_AUD が未設定です。Cloudflare 経由のスタッフ用の API は、すべて断ります（その PC の中からは使えます）",
  );
}

console.log(`api: http://localhost:${port}（データ置き場: ${dataDir}）`);

// default export にすると `bun --watch` の再起動でポートを掴み直してくれる。
// SSE の接続は長く開いたままなので、Bun の接続の待ち時間（既定 10 秒）を止める
export default { port, fetch: app.fetch, idleTimeout: 0 };
