// 負荷テストの集計（Q04）。画面もネットワークも使わない、純粋な計算。

/** 並べた値の、p 番目（0〜100）の値。最も近い順位の方法（小さい標本でも、実際にあった値が返る） */
export function percentile(sortedAscending: readonly number[], p: number): number {
  if (sortedAscending.length === 0) return Number.NaN;
  const rank = Math.ceil((p / 100) * sortedAscending.length);
  const index = Math.min(sortedAscending.length - 1, Math.max(0, rank - 1));
  return sortedAscending[index] ?? Number.NaN;
}

export type Summary = {
  count: number;
  min: number;
  mean: number;
  p50: number;
  p95: number;
  p99: number;
  max: number;
};

const EMPTY: Summary = {
  count: 0,
  min: Number.NaN,
  mean: Number.NaN,
  p50: Number.NaN,
  p95: Number.NaN,
  p99: Number.NaN,
  max: Number.NaN,
};

export function summarize(values: readonly number[]): Summary {
  if (values.length === 0) return EMPTY;
  const sorted = [...values].sort((a, b) => a - b);
  const sum = sorted.reduce((total, value) => total + value, 0);
  return {
    count: sorted.length,
    min: sorted[0] ?? Number.NaN,
    mean: sum / sorted.length,
    p50: percentile(sorted, 50),
    p95: percentile(sorted, 95),
    p99: percentile(sorted, 99),
    max: sorted[sorted.length - 1] ?? Number.NaN,
  };
}

/** API の呼び出しの記録。エンドポイントごと（IDを「:id」にそろえた名前）に、時間と結果を集める */
export type CallRecord = { label: string; ms: number; status: number | "network-error" };

/** パスの ID（26 文字の ULID）を、「:id」にして、同じエンドポイントを 1 つにまとめる */
export function endpointLabel(method: string, url: string): string {
  const path = new URL(url, "http://localhost").pathname.replace(/[0-9A-HJKMNP-TV-Z]{26}/g, ":id");
  return `${method.toUpperCase()} ${path}`;
}

export type EndpointStats = Summary & {
  label: string;
  /** 2xx の数 */
  ok: number;
  /** ステータスごとの数（2xx 以外。network-error も） */
  failures: Record<string, number>;
};

export function summarizeCalls(records: readonly CallRecord[]): EndpointStats[] {
  const byLabel = new Map<string, CallRecord[]>();
  for (const record of records) {
    const list = byLabel.get(record.label) ?? [];
    list.push(record);
    byLabel.set(record.label, list);
  }
  return [...byLabel.entries()]
    .map(([label, list]) => {
      const failures: Record<string, number> = {};
      let ok = 0;
      for (const record of list) {
        if (typeof record.status === "number" && record.status >= 200 && record.status < 300) ok++;
        else failures[String(record.status)] = (failures[String(record.status)] ?? 0) + 1;
      }
      return { label, ...summarize(list.map((r) => r.ms)), ok, failures };
    })
    .sort((a, b) => b.count - a.count);
}

/** 小数 1 桁 */
export const fixed1 = (value: number): string => (Number.isFinite(value) ? value.toFixed(1) : "-");

/** 秒を「3 分 20 秒」のようにする */
export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds)) return "-";
  const total = Math.round(seconds);
  if (total < 60) return `${total} 秒`;
  const minutes = Math.floor(total / 60);
  const rest = total % 60;
  return rest === 0 ? `${minutes} 分` : `${minutes} 分 ${rest} 秒`;
}
