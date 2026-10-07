import type { Database } from "@canbadge/db";
import type { SseEvent } from "@canbadge/shared";
import type { Context } from "hono";
import type { AbuseGuards } from "./abuse";
import type { AccessVerifier } from "./access";
import type { DiscordClient } from "./discord";
import type { TurnstileVerifier } from "./turnstile";

/** 操作ログから作った SSE イベントの配信口（events.ts） */
export type EventHub = {
  /** イベントを受け取る。戻り値は、受け取りをやめる関数 */
  subscribe: (listener: (event: SseEvent) => void) => () => void;
  /** 操作ログの新しい行を読み、イベントを配る（定期実行される。テストでは手で呼ぶ） */
  poll: () => void;
  stop: () => void;
  /** いま、イベントを受け取っている接続の数（SSE の接続の数。運用の確認に使う） */
  listenerCount: () => number;
};

/** ハンドラーが使うもの。起動時（index.ts）かテストが組み立てる */
export type Deps = {
  db: Database;
  /** データ置き場（DB・画像・PDF） */
  dataDir: string;
  events: EventHub;
  /** SSE の接続を保つための、空のコメント行（ハートビート）を送る間隔（ms）。省略すると 20 秒 */
  sseHeartbeatMs?: number | undefined;
  /**
   * スタッフ用・モニター用の API を、すべての経路に許すか。**開発で試すときだけ** true にする
   * （本番は false。経路ごとの扱いは guard.ts）
   */
  allowPublicStaff: boolean;
  /** Cloudflare Access の JWT の検証器。CF_ACCESS_* が未設定なら undefined（Cloudflare 経由のスタッフ用は、すべて断る） */
  access?: AccessVerifier | undefined;
  /** Discord のアイコンの取り込み（W08）。DISCORD_* が未設定なら undefined（取り込みは「使えません」で戻す） */
  discord?: DiscordClient | undefined;
  /** Turnstile の検証器。TURNSTILE_SECRET_KEY が未設定なら undefined（開発用。注文の確認を、検証しない） */
  turnstile?: TurnstileVerifier | undefined;
  /** 来場者向けの API の、回数の制限（A06） */
  abuse: AbuseGuards;
  /** 接続元のアドレス。サーバー（Bun）が知っている値。テストなど、わからないときは省略する */
  remoteAddressOf?: ((c: Context) => string | undefined) | undefined;
};
