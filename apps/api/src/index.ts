import { databasePath, getSetting, openDatabase, resolveDataDir } from "@canbadge/db";
import { getConnInfo } from "hono/bun";
import { createAbuseGuards } from "./abuse";
import { accessConfigFromEnv, createAccessVerifier } from "./access";
import { createApp } from "./app";
import { createDiscordClient, discordConfigFromEnv } from "./discord";
import { createEventHub } from "./events";
import { cleanupImages } from "./images";
import { createTurnstileVerifier } from "./turnstile";

const port = Number(process.env.API_PORT ?? 3002);
const dataDir = resolveDataDir();

// DB がなければ、空の DB を作る（サンプルデータは `bun run db:reset` で入れる）
const db = openDatabase({ path: databasePath(dataDir) });
const events = createEventHub(db, { intervalMs: Number(process.env.SSE_POLL_MS ?? 2000) });

const accessConfig = accessConfigFromEnv(process.env);
const allowPublicStaff = process.env.ALLOW_UNAUTHENTICATED_STAFF === "1";
const discordConfig = discordConfigFromEnv(process.env);
const turnstileSecret = process.env.TURNSTILE_SECRET_KEY?.trim();

const app = createApp({
  db,
  dataDir,
  events,
  // 開発用。本番では付けない（付けると、スタッフ認証なしで、公開経路からも使えてしまう）
  allowPublicStaff,
  // Cloudflare Access の JWT を検証する（A05）。未設定なら、Cloudflare 経由のスタッフ用は、すべて断る
  access: accessConfig ? createAccessVerifier(accessConfig) : undefined,
  // Turnstile のトークンを、サーバーで検証する（A06）。未設定なら、検証しない（開発用）
  turnstile: turnstileSecret ? createTurnstileVerifier({ secret: turnstileSecret }) : undefined,
  // Discord のアイコンの取り込み（W08）。未設定なら、取り込みは「使えません」で戻す
  discord: discordConfig
    ? createDiscordClient(discordConfig, {
        maxAvatarBytes: getSetting(db.orm).imageMaxBytes,
      })
    : undefined,
  abuse: createAbuseGuards(),
  remoteAddressOf: (c) => getConnInfo(c).remote.address,
});

if (!turnstileSecret) {
  console.warn(
    "api: TURNSTILE_SECRET_KEY が未設定です。注文の確認（Turnstile）を、サーバーで検証しません（開発用。本番では必ず設定する）",
  );
}

if (allowPublicStaff) {
  console.warn(
    "api: 警告 ALLOW_UNAUTHENTICATED_STAFF=1 のため、スタッフ用の API が、認証なしで、どの経路からも使えます（開発用）",
  );
} else if (!accessConfig) {
  console.warn(
    "api: CF_ACCESS_TEAM_DOMAIN・CF_ACCESS_AUD が未設定です。Cloudflare 経由のスタッフ用の API は、すべて断ります（その PC の中からは使えます）",
  );
}

// 使われない画像を、起動時と 5 分ごとに消す（A02）。失敗しても、api は止めない
const cleanImages = () => {
  try {
    const { deletedImages, deletedThumbnails } = cleanupImages(db, dataDir);
    if (deletedImages > 0 || deletedThumbnails > 0) {
      console.log(
        `api: 使われない画像を ${deletedImages} 枚（サムネイル ${deletedThumbnails} 枚）消しました`,
      );
    }
  } catch (error) {
    console.error("api: 画像の掃除に失敗しました（次の巡回で、もう一度）", error);
  }
};
cleanImages();
setInterval(cleanImages, 5 * 60 * 1000).unref();

console.log(`api: http://localhost:${port}（データ置き場: ${dataDir}）`);

// default export にすると `bun --watch` の再起動でポートを掴み直してくれる。
// SSE の接続は長く開いたままなので、Bun の接続の待ち時間（既定 10 秒）を止める
export default { port, fetch: app.fetch, idleTimeout: 0 };
