import type { Context } from "hono";
import type { Deps } from "./deps";
import { ApiException } from "./errors";

/**
 * スタッフ用・モニター用の API を、公開経路から使えなくする。
 * スタッフ認証（A05）ができるまでは、認証なしで状態を変えられてしまうため、
 * Cloudflare を通ったリクエスト（cf-ray ヘッダーが付く）は断る。
 * 会場の PC（localhost）や LAN からは使える。開発で試すときだけ ALLOW_UNAUTHENTICATED_STAFF=1 で許す
 */
export function assertNotPublic(c: Context, deps: Deps): void {
  if (deps.allowPublicStaff) return;
  if (c.req.header("cf-ray") !== undefined || c.req.header("cf-connecting-ip") !== undefined) {
    throw new ApiException(
      "UNAUTHORIZED",
      "スタッフ用の機能は、認証（A05）ができるまで、公開されたアドレスからは使えません",
    );
  }
}
