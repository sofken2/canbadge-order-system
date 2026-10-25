import { badgeSpec, slotsPerSheet } from "@canbadge/badge-spec";
import {
  assembler,
  cashier,
  createDesks,
  monitor,
  pickupDesk,
  printWatcher,
  sampler,
  visitor,
} from "./actors";
import type { LoadConfig } from "./config";
import { buildReport, type FinalState, type Report } from "./report";
import { createClock, exponential } from "./sim";
import { createWorld, makeClient, type OrderRecord, type World } from "./world";

// 負荷テストの実行（Q04）：模擬の来場者がばらばらに来て、模擬のスタッフが、本物の API で、受け渡しまで進める。

/** スタッフ用 API から、最終的な状態を、すべて読み取る（整合性の確認に使う） */
export async function readFinalState(world: World): Promise<FinalState> {
  const client = makeClient(world);
  const orders: FinalState["orders"] = [];
  for (let before: string | undefined; ; ) {
    const page = await client.call("searchStaffOrders", {
      query: { limit: 100, ...(before ? { before } : {}) },
    });
    orders.push(...page.items.map((o) => ({ orderNumber: o.orderNumber, status: o.status })));
    if (!page.nextBefore) break;
    before = page.nextBefore;
  }
  const settings = await client.call("getSettings");
  const sales = await client.call("getSales", { query: {} });
  const sheets: FinalState["sheets"] = [];
  for (let before: string | undefined; ; ) {
    const page = await client.call("listPrintSheets", {
      query: { limit: 100, ...(before ? { before } : {}) },
    });
    sheets.push(
      ...page.items.map((s) => ({
        id: s.id,
        status: s.status,
        slots: s.slots.map((slot) => ({ orderNumber: slot.orderNumber, result: slot.result })),
      })),
    );
    if (!page.nextBefore) break;
    before = page.nextBefore;
  }
  return {
    orders,
    price: settings.price,
    sales: sales.total,
    sheets,
    slotsPerSheet: slotsPerSheet(badgeSpec),
  };
}

export type RunOptions = {
  baseUrl: string;
  /** 進み具合を知らせる（端末に出す）。省略すると、出さない */
  progress?: (message: string) => void;
};

/** 負荷テストを 1 回流して、報告を返す */
export async function runLoad(config: LoadConfig, options: RunOptions): Promise<Report> {
  const startedAt = Date.now();
  const clock = createClock(config.speed, startedAt);
  const world = createWorld(config, clock, options.baseUrl);
  const desks = createDesks();
  const staff = makeClient(world);

  // 動いているサーバーに流すときは、本物の注文を壊さないよう、未完成の注文がないことを確かめる
  if (config.target) {
    const unfinished = await staff.call("searchStaffOrders", {
      query: { status: "submitted,paid,assembling,ready", limit: 1 },
    });
    if (unfinished.items.length > 0) {
      throw new Error(
        "動いているサーバーに、未完成の注文があります。本物の注文が混ざるので、流しません（リハーサル専用の、空の環境に流してください）",
      );
    }
  }

  // 営業を開始する（営業開始の前は、注文できない）。すでに今日の営業中なら、触らない
  const setting = await staff.call("getSettings");
  if (setting.businessDate === null || setting.acceptance !== "open") {
    await staff.call("openBusinessDay");
  }

  // 担当を動かす
  const sampling = sampler(world, desks);
  monitor(world);
  const actors: Promise<void>[] = [
    printWatcher(world),
    ...Array.from({ length: config.cashiers }, () => cashier(world, desks)),
    ...Array.from({ length: config.assemblers }, () => assembler(world)),
    ...Array.from({ length: config.pickupStaff }, () => pickupDesk(world, desks)),
  ];
  // 担当の途中のエラーは、その担当を止めるが、全体は止めない（結果の「失敗」に、理由が残る）
  const guarded = actors.map((p) =>
    p.catch((error) => {
      options.progress?.(
        `担当が止まりました: ${error instanceof Error ? error.message : String(error)}`,
      );
    }),
  );

  // 来場者を、ばらばらの間隔（指数分布）で、来させる
  const meanGapSeconds = (config.arrivalMinutes * 60) / config.visitors;
  const visitors: Promise<void>[] = [];
  const ticker = setInterval(() => {
    const done = world.orders.filter((o) => o.finished).length;
    options.progress?.(
      `  仮想 ${(clock.virtualNow() / 60).toFixed(0)} 分: 来場 ${world.orders.length}/${config.visitors}・受け渡し済み ${done}・レジの列 ${desks.booth.length}・受け渡しの列 ${desks.pickup.length}`,
    );
  }, 3000);

  for (let i = 0; i < config.visitors; i++) {
    if (i > 0) await clock.sleep(exponential(world.random, meanGapSeconds));
    const order: OrderRecord = {
      index: i + 1,
      at: {},
      actionRealMs: {},
      sseDelayMs: {},
      reprinted: false,
      finished: false,
    };
    world.orders.push(order);
    visitors.push(visitor(world, desks, order));
  }

  // 全員が来たあと、片づくまで待つ（最大 drainMinutes）
  const drained = Promise.all(visitors).then(() => "drained" as const);
  const timeout = clock.sleep(config.drainMinutes * 60).then(() => "timeout" as const);
  const outcome = await Promise.race([drained, timeout]);
  clearInterval(ticker);
  if (outcome === "timeout") options.progress?.("時間切れ：片づかなかった注文を残して、止めます");

  // 止める
  const realSeconds = (Date.now() - startedAt) / 1000;
  sampling.stop();
  world.abort.abort();
  desks.booth.close();
  desks.pickup.close();
  await Promise.race([Promise.allSettled(guarded), Bun.sleep(5000)]);
  await Promise.race([Promise.allSettled(visitors), Bun.sleep(2000)]);

  const state = await readFinalState(world);
  return buildReport(world, state, realSeconds);
}
