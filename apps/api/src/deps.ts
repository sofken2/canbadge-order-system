import type { Database } from "@canbadge/db";
import type { SseEvent } from "@canbadge/shared";
import type { Context } from "hono";
import type { AccessVerifier } from "./access";

/** 操作ログから作った SSE イベントの配信口（events.ts） */
export type EventHub = {
  /** イベントを受け取る。戻り値は、受け取りをやめる関数 */
  subscribe: (listener: (event: SseEvent) => void) => () => void;
  /** 操作ログの新しい行を読み、イベントを配る（定期実行される。テストでは手で呼ぶ） */
  poll: () => void;
  stop: () => void;
};

/** ハンドラーが使うもの。起動時（index.ts）かテストが組み立てる */
export type Deps = {
  db: Database;
  /** データ置き場（DB・画像・PDF） */
  dataDir: string;
  events: EventHub;
  /**
   * スタッフ用・モニター用の API を、すべての経路に許すか。**開発で試すときだけ** true にする
   * （本番は false。経路ごとの扱いは guard.ts）
   */
  allowPublicStaff: boolean;
  /** Cloudflare Access の JWT の検証器。CF_ACCESS_* が未設定なら undefined（Cloudflare 経由のスタッフ用は、すべて断る） */
  access?: AccessVerifier | undefined;
  /** 接続元のアドレス。サーバー（Bun）が知っている値。テストなど、わからないときは省略する */
  remoteAddressOf?: ((c: Context) => string | undefined) | undefined;
};
