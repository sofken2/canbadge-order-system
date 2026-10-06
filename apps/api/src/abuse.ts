import type { Context } from "hono";
import { ApiException } from "./errors";
import { clientAddress } from "./origin";
import { type Clock, createRateLimiter, type RateLimiter } from "./rate-limit";

// 来場者向けの API の、回数の制限（A06）。
// 学内のネットワークは、多くの人が同じ IP を共有する（NAT）ことがあるので、IP ごとの上限は、ゆるく取る。
// 注文の数そのものは、端末ごとの「支払い待ちの上限」（db）が抑える。ここは、機械的な連打と、総当たりを止める。

export const LIMITS = {
  /** 注文の作成：1 つの IP から、10 分で */
  orders: { limit: 30, windowMs: 10 * 60 * 1000 },
  /** 画像のアップロード：1 つの IP から、10 分で */
  uploads: { limit: 60, windowMs: 10 * 60 * 1000 },
  /** 注文の照会：1 つの IP から、5 分で（成功も失敗も数える） */
  lookups: { limit: 30, windowMs: 5 * 60 * 1000 },
  /** 注文の照会に失敗した回数：1 つの IP から、5 分で。確認コード（31^4 通り）の総当たりを止める */
  lookupFailuresByIp: { limit: 10, windowMs: 5 * 60 * 1000 },
  /** 注文の照会に失敗した回数：1 つの注文番号に対して、誰からでも、15 分で。IP を変えて試す総当たりを止める */
  lookupFailuresByNumber: { limit: 10, windowMs: 15 * 60 * 1000 },
} as const;

export type AbuseGuards = {
  orders: RateLimiter;
  uploads: RateLimiter;
  lookups: RateLimiter;
  lookupFailuresByIp: RateLimiter;
  lookupFailuresByNumber: RateLimiter;
};

export function createAbuseGuards(now?: Clock): AbuseGuards {
  const make = (config: { limit: number; windowMs: number }) =>
    createRateLimiter({ ...config, ...(now ? { now } : {}) });
  return {
    orders: make(LIMITS.orders),
    uploads: make(LIMITS.uploads),
    lookups: make(LIMITS.lookups),
    lookupFailuresByIp: make(LIMITS.lookupFailuresByIp),
    lookupFailuresByNumber: make(LIMITS.lookupFailuresByNumber),
  };
}

/** 来場者の IP。Cloudflare 経由なら cf-connecting-ip、Caddy 経由なら X-Forwarded-For のいちばん右、直接なら接続元 */
export function visitorIp(c: Context, remoteAddress: string | undefined): string {
  return clientAddress({ headers: c.req.raw.headers, remoteAddress }) ?? "unknown";
}

/** 秒数を、人に読める言い方にする（「あと 1 分 30 秒」など） */
export function waitText(seconds: number): string {
  if (seconds < 60) return `${seconds} 秒`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return rest === 0 ? `${minutes} 分` : `${minutes} 分 ${rest} 秒`;
}

/** 制限に達していたら、RATE_LIMITED（429）を投げる。待つ秒数は、Retry-After にも入る */
export function enforce(
  limiter: RateLimiter,
  key: string,
  message: (wait: string) => string,
): void {
  const result = limiter.hit(key);
  if (!result.allowed) {
    throw new ApiException(
      "RATE_LIMITED",
      message(waitText(result.retryAfterSeconds)),
      undefined,
      result.retryAfterSeconds,
    );
  }
}

/** 記録を増やさずに、制限に達しているかだけを確かめる */
export function assertNotLimited(
  limiter: RateLimiter,
  key: string,
  message: (wait: string) => string,
): void {
  const result = limiter.peek(key);
  if (!result.allowed) {
    throw new ApiException(
      "RATE_LIMITED",
      message(waitText(result.retryAfterSeconds)),
      undefined,
      result.retryAfterSeconds,
    );
  }
}
