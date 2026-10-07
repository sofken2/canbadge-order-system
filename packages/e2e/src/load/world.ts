import { type ApiClient, createApiClient } from "@canbadge/api-client";
import type { SseEvent } from "@canbadge/shared";
import { sseEventSchema } from "@canbadge/shared";
import type { LoadConfig } from "./config";
import { type Clock, createRandom } from "./sim";
import { type CallRecord, endpointLabel } from "./stats";

// 負荷テストの、共有の状態（Q04）。サーバーへの呼び出しの記録、注文ごとの時刻、SSE の接続。

/** 注文の状態の、進む順（SSE で、より進んだ状態を見たら、それまでの状態も通ったものとして扱う） */
export const STATUS_ORDER = [
  "submitted",
  "paid",
  "printed",
  "assembling",
  "ready",
  "picked_up",
] as const;
export type Stage = (typeof STATUS_ORDER)[number];
export const stageIndex = (status: string): number => STATUS_ORDER.indexOf(status as Stage);

/** 1 件の注文の記録。時刻は、開始からの仮想の秒 */
export type OrderRecord = {
  index: number;
  orderId?: string;
  orderNumber?: number;
  code?: string;
  /** 各状態になった時刻（スタッフ側の操作が終わった時刻） */
  at: Partial<Record<Stage | "arrived" | "atBooth", number>>;
  /** 各状態の操作が終わった、実際の時刻（ms）。SSE が届くまでの遅れを測る */
  actionRealMs: Partial<Record<Stage, number>>;
  /** 各状態の SSE が、操作から、届くまでの実際の遅れ（ms） */
  sseDelayMs: Partial<Record<Stage, number>>;
  /** 来場者の画面が、最後に見た状態（SSE） */
  lastSeenStatus?: string;
  reprinted: boolean;
  /** 最後まで終わったか */
  finished: boolean;
  /** 想定外のエラー（作業が止まった理由） */
  failure?: string;
};

export type World = {
  config: LoadConfig;
  clock: Clock;
  random: () => number;
  baseUrl: string;
  orders: OrderRecord[];
  calls: CallRecord[];
  /** 担当ごとの、作業していた時間の合計（仮想の秒）。稼働率の計算に使う */
  busySeconds: Record<"cashier" | "assembler" | "pickup" | "check", number>;
  /** 待った時間の記録（仮想の秒）。列に入ってから、担当が取るまで */
  waits: Record<"cashier" | "print" | "assembly" | "pickup", number[]>;
  /** 印刷したシートの記録 */
  sheets: { slots: number; printedAt: number; checkedAt: number }[];
  /** 時間ごとの、各段階の件数（グラフ・ピークの確認用） */
  samples: Sample[];
  /** 想定内の失敗の数（組み立ての取り合いで、別の人が先に取った、など） */
  expected: Record<string, number>;
  /** SSE の接続の数（いま・最大） */
  sse: { open: number; peak: number; errors: number };
  /** 実行を止めるための合図 */
  abort: AbortController;
};

export type Sample = {
  /** 仮想の秒 */
  t: number;
  waitingPay: number;
  waitingPrint: number;
  waitingAssembly: number;
  assembling: number;
  ready: number;
  done: number;
  boothQueue: number;
  pickupQueue: number;
};

export function createWorld(config: LoadConfig, clock: Clock, baseUrl: string): World {
  return {
    config,
    clock,
    random: createRandom(config.seed),
    baseUrl,
    orders: [],
    calls: [],
    busySeconds: { cashier: 0, assembler: 0, pickup: 0, check: 0 },
    waits: { cashier: [], print: [], assembly: [], pickup: [] },
    sheets: [],
    samples: [],
    expected: {},
    sse: { open: 0, peak: 0, errors: 0 },
    abort: new AbortController(),
  };
}

export const countExpected = (world: World, name: string) => {
  world.expected[name] = (world.expected[name] ?? 0) + 1;
};

/** 時間を測って記録する fetch。接続のしかた（ヘッダー）を差し込める */
export function timedFetch(world: World, headers: Record<string, string> = {}): typeof fetch {
  const wrapped = async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const method = init?.method ?? "GET";
    const label = endpointLabel(method, url);
    const started = performance.now();
    try {
      const response = await fetch(input, {
        ...init,
        headers: { ...(init?.headers as Record<string, string> | undefined), ...headers },
      });
      world.calls.push({ label, ms: performance.now() - started, status: response.status });
      return response;
    } catch (error) {
      world.calls.push({ label, ms: performance.now() - started, status: "network-error" });
      throw error;
    }
  };
  return wrapped as typeof fetch;
}

/** 担当・来場者ごとの API クライアント。headers で、来場者ごとに、別の接続元（IP）に見せる */
export function makeClient(world: World, headers: Record<string, string> = {}): ApiClient {
  return createApiClient({ baseUrl: world.baseUrl, fetch: timedFetch(world, headers) });
}

/** SSE を購読する。届いた（契約に合う）イベントごとに onEvent を呼ぶ。signal で止める */
export function openSse(
  world: World,
  path: string,
  onEvent: (event: SseEvent) => void,
  options: { headers?: Record<string, string>; signal: AbortSignal },
): { connected: Promise<void> } {
  let markConnected: () => void = () => undefined;
  const connected = new Promise<void>((resolve) => {
    markConnected = resolve;
  });

  void (async () => {
    try {
      const response = await fetch(`${world.baseUrl}${path}`, {
        headers: options.headers ?? {},
        signal: options.signal,
      });
      const reader = response.body?.getReader();
      if (!reader || !response.ok) {
        world.sse.errors++;
        markConnected();
        return;
      }
      world.sse.open++;
      world.sse.peak = Math.max(world.sse.peak, world.sse.open);
      try {
        const decoder = new TextDecoder();
        let buffer = "";
        for (;;) {
          const { value, done } = await reader.read();
          if (done) return;
          buffer += decoder.decode(value, { stream: true });
          const blocks = buffer.split("\n\n");
          buffer = blocks.pop() ?? "";
          for (const block of blocks) {
            if (block.startsWith(": connected")) markConnected();
            const data = block.split("\n").find((line) => line.startsWith("data: "));
            if (!data) continue;
            const parsed = sseEventSchema.safeParse(JSON.parse(data.slice(6)));
            if (parsed.success) onEvent(parsed.data);
          }
        }
      } finally {
        world.sse.open--;
      }
    } catch {
      // 止めたとき（signal）の中断。ここでは、数えない
      if (!options.signal.aborted) world.sse.errors++;
      markConnected();
    }
  })();

  return { connected };
}

/**
 * スタッフの画面と同じ動き：「変わった」の通知が来るたびに、一覧を取り直す（ふつうの画面は、そうしている）。
 * 通知が続いても、取り直しは、実際の 250ms に 1 回まで
 */
export function watchAndRefetch(
  world: World,
  path: string,
  refetch: () => Promise<void>,
  signal: AbortSignal,
): void {
  let pending = false;
  let last = 0;
  const run = async () => {
    if (pending) return;
    pending = true;
    try {
      const wait = Math.max(0, 250 - (Date.now() - last));
      if (wait > 0) await Bun.sleep(wait);
      last = Date.now();
      pending = false;
      await refetch();
    } catch {
      // 取り直しの失敗は、呼び出しの記録に残る
      pending = false;
    }
  };
  openSse(world, path, () => void run(), { signal });
}
