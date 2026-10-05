import type { Database } from "@canbadge/db";
import type { SseEvent } from "@canbadge/shared";

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
   * スタッフ用・モニター用の API を、Cloudflare 経由（公開経路）のリクエストにも許すか。
   * 認証（A05）ができるまでは false にして、公開経路からは使えなくする
   */
  allowPublicStaff: boolean;
};
