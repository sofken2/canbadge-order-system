// シミュレーションの道具（Q04）：再現できる乱数、時間の圧縮、順番待ちの列。

/** 種から作る乱数（0 以上 1 未満）。同じ種なら、同じ並びになる（再現できる負荷テストにするため） */
export function createRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 平均 mean（秒）の、指数分布の待ち時間（客が、ばらばらに、来る間隔） */
export function exponential(random: () => number, mean: number): number {
  return -Math.log(1 - random()) * mean;
}

/** 平均 mean を中心に、±spread の割合でばらつく値（作業時間など。0〜1 の割合） */
export function jitter(random: () => number, mean: number, spread = 0.4): number {
  return mean * (1 - spread + 2 * spread * random());
}

/** min〜max の一様な値 */
export function between(random: () => number, min: number, max: number): number {
  return min + (max - min) * random();
}

/**
 * 時間の圧縮。人の動き（歩く・作業する）は、仮想の秒で決め、speed 倍の速さで進める。
 * 例：speed 30 なら、仮想の 60 分が、実際の 2 分。サーバーへの負荷も、その分、濃くなる
 */
export function createClock(speed: number, startMs = Date.now()) {
  return {
    speed,
    /** 仮想の秒を、実際の待ちにする */
    sleep: (virtualSeconds: number) => Bun.sleep((virtualSeconds * 1000) / speed),
    /** 開始からの、仮想の秒 */
    virtualNow: () => ((Date.now() - startMs) / 1000) * speed,
    /** 実際の ms を、仮想の秒にする */
    toVirtual: (realMs: number) => (realMs / 1000) * speed,
    startMs,
  };
}
export type Clock = ReturnType<typeof createClock>;

/** 先に入ったものから、順に取り出す列。空のとき、take は、入るまで待つ（担当者が、次の客を待つ） */
export function createQueue<T>() {
  const items: T[] = [];
  const waiters: ((value: T | undefined) => void)[] = [];
  let closed = false;
  return {
    push(item: T) {
      const waiter = waiters.shift();
      if (waiter) waiter(item);
      else items.push(item);
    },
    /** 次を 1 つ取る。閉じていて空なら undefined */
    take(): Promise<T | undefined> {
      const next = items.shift();
      if (next !== undefined) return Promise.resolve(next);
      if (closed) return Promise.resolve(undefined);
      return new Promise((resolve) => waiters.push(resolve));
    },
    /** もう入らない。待っている担当者を、終わらせる */
    close() {
      closed = true;
      for (const waiter of waiters.splice(0)) waiter(undefined);
    },
    get length() {
      return items.length;
    },
  };
}
export type Queue<T> = ReturnType<typeof createQueue<T>>;
