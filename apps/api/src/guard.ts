import type { Context } from "hono";
import type { Deps } from "./deps";
import { ApiException } from "./errors";
import { classifyOrigin } from "./origin";

/**
 * スタッフ用・モニター用の API を、使ってよい相手だけに使わせる（A05）。
 *
 * | 経路 | スタッフ用（/api/staff/*） | モニター用（/api/monitor/*） |
 * | --- | --- | --- |
 * | Cloudflare 経由 | Access の JWT の署名を検証して通す。なければ断る | 断る |
 * | その PC の中（localhost） | 通す | 通す |
 * | 会場の LAN など | 断る（PIN 認証は、優先度を下げた機能で、未実装） | 断る |
 *
 * 開発で試すときだけ、ALLOW_UNAUTHENTICATED_STAFF=1 で、すべての経路を通す。
 */
export async function authorizeNonVisitor(
  c: Context,
  deps: Deps,
  kind: "staff" | "monitor",
): Promise<void> {
  if (deps.allowPublicStaff) return;

  const origin = classifyOrigin({
    headers: c.req.raw.headers,
    remoteAddress: deps.remoteAddressOf?.(c),
  });
  if (origin === "local") return;

  if (origin === "lan") {
    throw new ApiException(
      "UNAUTHORIZED",
      "この経路からは、スタッフ用の機能を使えません。スタッフ用のアドレス（Cloudflare 経由）から開いてください",
    );
  }

  // Cloudflare 経由。呼び出しモニターは、処理 PC の中だけ
  if (kind === "monitor") {
    throw new ApiException(
      "UNAUTHORIZED",
      "呼び出しモニターは、処理 PC の中（localhost）からだけ使えます",
    );
  }
  if (!deps.access) {
    // 設定がないまま、公開経路を通すと、誰でも使えてしまう。閉じておく
    console.error(
      "api: CF_ACCESS_TEAM_DOMAIN・CF_ACCESS_AUD が未設定のため、スタッフ用の API を断りました",
    );
    throw new ApiException(
      "UNAUTHORIZED",
      "スタッフ認証が設定されていないため、使えません。管理者に連絡してください",
    );
  }
  const result = await deps.access.verify(c.req.header("cf-access-jwt-assertion"));
  if (!result.ok) {
    // 理由は、ログにだけ残す（画面には、認証の仕組みの詳細を見せない）
    console.warn(`api: スタッフ認証に失敗しました（${result.reason}）`);
    throw new ApiException(
      "UNAUTHORIZED",
      "スタッフ認証を確認できませんでした。ログインし直してください",
    );
  }
}
