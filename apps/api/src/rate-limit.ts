// 回数の制限（A06）。処理 PC は 1 台で、api は 1 プロセスなので、状態はメモリに持つ
// （再起動すると、数え直しになる。学祭の規模では、それで十分）。時計は、テストで差し替えられる。

export type Clock = () => number;

export type LimitResult = { allowed: true } | { allowed: false; retryAfterSeconds: number };

/**
 * 一定の時間の中で、同じ相手（key）が使える回数を、数える。
 * 窓をずらしながら数える（固定の区切りの境目で、倍の回数が通ってしまうのを防ぐ）
 */
export function createRateLimiter(options: { limit: number; windowMs: number; now?: Clock }) {
  const now = options.now ?? Date.now;
  const hits = new Map<string, number[]>();
  let lastSweep = now();

  /** 古い記録を捨てる。key が増え続けないよう、窓の長さごとに、全体を掃除する */
  function sweep(at: number) {
    if (at - lastSweep < options.windowMs) return;
    lastSweep = at;
    for (const [key, times] of hits) {
      const recent = times.filter((t) => at - t < options.windowMs);
      if (recent.length === 0) hits.delete(key);
      else hits.set(key, recent);
    }
  }

  return {
    /** 1 回使う。通れば記録し、通れなければ、あと何秒で空くかを返す（通れなかった回は、数えない） */
    hit(key: string): LimitResult {
      const at = now();
      sweep(at);
      const recent = (hits.get(key) ?? []).filter((t) => at - t < options.windowMs);
      if (recent.length >= options.limit) {
        hits.set(key, recent);
        const oldest = recent[0] ?? at;
        return {
          allowed: false,
          retryAfterSeconds: Math.max(1, Math.ceil((oldest + options.windowMs - at) / 1000)),
        };
      }
      recent.push(at);
      hits.set(key, recent);
      return { allowed: true };
    },
    /** いま、制限に達しているか（記録は増やさない） */
    peek(key: string): LimitResult {
      const at = now();
      const recent = (hits.get(key) ?? []).filter((t) => at - t < options.windowMs);
      if (recent.length < options.limit) return { allowed: true };
      const oldest = recent[0] ?? at;
      return {
        allowed: false,
        retryAfterSeconds: Math.max(1, Math.ceil((oldest + options.windowMs - at) / 1000)),
      };
    },
    /** 記録を消す（成功したら、失敗の数え直しをするため） */
    reset(key: string) {
      hits.delete(key);
    },
    /** 記録している key の数（テスト用） */
    size: () => hits.size,
  };
}

export type RateLimiter = ReturnType<typeof createRateLimiter>;
