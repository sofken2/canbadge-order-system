import { ApiClientError } from "@canbadge/api-client";
import { encodePng } from "@canbadge/fixtures";
import type { StaffOrderView } from "@canbadge/shared";
import { between, createQueue, jitter, type Queue } from "./sim";
import {
  countExpected,
  makeClient,
  type OrderRecord,
  openSse,
  STATUS_ORDER,
  type Stage,
  stageIndex,
  type World,
  watchAndRefetch,
} from "./world";

// 模擬の来場者とスタッフ（Q04）。それぞれが、本物の画面と同じ API を、同じ順で呼ぶ。
// 作業にかかる時間は、仮想の秒で決め、時間の圧縮（speed）で、実際の待ちにする。

/** レジに並んだ来場者 */
type BoothTask = { order: OrderRecord; enqueuedAt: number };
/** 受け渡しに来た来場者 */
type PickupTask = { order: OrderRecord; enqueuedAt: number; done: () => void };

export type Desks = {
  booth: Queue<BoothTask>;
  pickup: Queue<PickupTask>;
};
export const createDesks = (): Desks => ({ booth: createQueue(), pickup: createQueue() });

const png = () => new Uint8Array(8 * 8 * 3).fill(150);
const image = () =>
  new File([encodePng(8, 8, png()) as unknown as BlobPart], "badge.png", { type: "image/png" });

/** 来場者ごとに、別の接続元に見せる（IP ごとの回数の制限に、全員が、1 人として数えられないように） */
const visitorHeaders = (index: number): Record<string, string> => ({
  "cf-connecting-ip": `10.${(index >> 16) & 255}.${(index >> 8) & 255}.${index & 255 || 1}`,
});

/** 操作が終わったときに呼ぶ。状態と、その時刻を、記録する（SSE が届くまでの遅れを測る基準になる） */
function mark(world: World, order: OrderRecord, stage: Stage) {
  order.at[stage] = world.clock.virtualNow();
  order.actionRealMs[stage] = Date.now();
}

/** 失敗したとき、その来場者の記録に理由を残して、そこで終わる（ほかの来場者には、影響させない） */
function fail(order: OrderRecord, error: unknown) {
  order.failure = error instanceof Error ? error.message : String(error);
}

/**
 * 来場者 1 人：注文する → 注文状況を開く（SSE）→ ブースへ歩く → レジに並ぶ → ... → できあがりを知る →
 * 受け取りに来る → 受け渡しの列に並ぶ。終わったら（受け渡しが済んだら）解決する
 */
export async function visitor(world: World, desks: Desks, order: OrderRecord): Promise<void> {
  const { config, clock } = world;
  const headers = visitorHeaders(order.index);
  const client = makeClient(world, headers);
  const sseAbort = new AbortController();
  world.abort.signal.addEventListener("abort", () => sseAbort.abort(), { once: true });

  try {
    order.at.arrived = clock.virtualNow();
    const { imageId } = await client.uploadImage(image());
    const { orderId } = await client.call("createOrder", {
      body: {
        imageId,
        editorData: { version: 1 },
        quantity: 1,
        turnstileToken: "load-test",
        rightsConsent: true,
      },
    });
    order.orderId = orderId;
    mark(world, order, "submitted");
    const view = await client.call("getOrder", { params: { orderId } });
    order.orderNumber = view.orderNumber;
    order.code = view.confirmationCode;

    // 注文状況のページを開く：できあがりまで、SSE でつないでおく
    const ready = new Promise<void>((resolve) => {
      openSse(
        world,
        `/api/events/orders/${orderId}`,
        (event) => {
          if (event.type !== "order.updated") return;
          if (
            order.lastSeenStatus === undefined ||
            stageIndex(event.status) > stageIndex(order.lastSeenStatus)
          ) {
            order.lastSeenStatus = event.status;
          }
          const stage = event.status as Stage;
          const action = order.actionRealMs[stage];
          if (action !== undefined && order.sseDelayMs[stage] === undefined) {
            order.sseDelayMs[stage] = Date.now() - action;
          }
          if (stageIndex(event.status) >= stageIndex("ready")) resolve();
        },
        { headers, signal: sseAbort.signal },
      );
      // 中断されたら、待ちを終わらせる
      world.abort.signal.addEventListener("abort", () => resolve(), { once: true });
    });

    // ブースへ歩いて、レジに並ぶ
    await clock.sleep(between(world.random, config.walkMinSeconds, config.walkMaxSeconds));
    order.at.atBooth = clock.virtualNow();
    desks.booth.push({ order, enqueuedAt: clock.virtualNow() });

    // 支払い・印刷・組み立てが済んで、できあがりを知るまで待つ
    await ready;
    if (world.abort.signal.aborted) return;

    // できあがりを知ってから、受け取りに来るまで
    await clock.sleep(
      between(world.random, config.pickupMinDelaySeconds, config.pickupMaxDelaySeconds),
    );
    await new Promise<void>((resolve) => {
      desks.pickup.push({ order, enqueuedAt: clock.virtualNow(), done: resolve });
      world.abort.signal.addEventListener("abort", () => resolve(), { once: true });
    });
  } catch (error) {
    fail(order, error);
  } finally {
    sseAbort.abort();
  }
}

/** レジ係：列の先頭の来場者の注文を、番号で探して、支払い済みにする（S02 と同じ API の順） */
export async function cashier(world: World, desks: Desks): Promise<void> {
  const { config, clock } = world;
  const client = makeClient(world);
  watchAndRefetch(
    world,
    "/api/staff/events",
    async () => {
      await client.call("searchStaffOrders", { query: { status: "submitted", limit: 12 } });
    },
    world.abort.signal,
  );
  for (;;) {
    const task = await desks.booth.take();
    if (!task || world.abort.signal.aborted) return;
    const { order } = task;
    world.waits.cashier.push(clock.virtualNow() - task.enqueuedAt);
    const started = clock.virtualNow();
    try {
      const found = await client.call("searchStaffOrders", {
        query: { q: String(order.orderNumber), status: "submitted", limit: 5 },
      });
      const target = found.items.find((item) => item.orderNumber === order.orderNumber);
      if (!target) throw new Error(`支払い待ちの注文 ${order.orderNumber} が見つかりません`);
      await clock.sleep(jitter(world.random, config.cashierServiceSeconds));
      await client.call("payOrder", { params: { orderId: target.id } });
      mark(world, order, "paid");
    } catch (error) {
      fail(order, error);
    } finally {
      world.busySeconds.cashier += clock.virtualNow() - started;
    }
  }
}

/**
 * 印刷確認の担当：印刷中のシートが出たら、プリンターが印刷する時間と、確認の時間のあと、確認する。
 * 一部を再印刷にする（reprintRate）。確認が済むまで、次のシートは出ない（同時に 1 枚）
 */
export async function printChecker(world: World): Promise<void> {
  const { config, clock } = world;
  const client = makeClient(world);
  let lastSheet: string | undefined;
  while (!world.abort.signal.aborted) {
    try {
      const { sheet } = await client.call("getCurrentPrintSheet");
      if (sheet && sheet.id !== lastSheet) {
        lastSheet = sheet.id;
        const printedAt = clock.virtualNow();
        // 用紙を、プリンターが印刷している間
        await clock.sleep(config.printSeconds);
        const started = clock.virtualNow();
        await clock.sleep(jitter(world.random, config.checkServiceSeconds));
        const reprint = sheet.slots
          .filter(() => world.random() < config.reprintRate)
          .map((slot) => slot.orderItemId);
        await client.call("checkPrintSheet", {
          params: { sheetId: sheet.id },
          body: { reprintOrderItemIds: reprint },
        });
        const checkedAt = clock.virtualNow();
        world.busySeconds.check += checkedAt - started;
        world.sheets.push({ slots: sheet.slots.length, printedAt, checkedAt });
        const reprinted = new Set(
          sheet.slots.filter((s) => reprint.includes(s.orderItemId)).map((s) => s.orderNumber),
        );
        for (const slot of sheet.slots) {
          const record = world.orders.find((o) => o.orderNumber === slot.orderNumber);
          if (!record) continue;
          if (reprinted.has(slot.orderNumber)) {
            record.reprinted = true;
            continue;
          }
          mark(world, record, "printed");
        }
        continue;
      }
    } catch (error) {
      countExpected(world, `印刷確認: ${error instanceof Error ? error.message : String(error)}`);
    }
    await Bun.sleep(250);
  }
}

/** 組み立て係：「組み立て待ち」の一覧から、1 つ取り（組み立て開始）、作業して、完成にする（S04 と同じ API の順） */
export async function assembler(world: World): Promise<void> {
  const { config, clock } = world;
  const client = makeClient(world);
  let list: StaffOrderView[] = [];
  let wake: () => void = () => undefined;
  const refetch = async () => {
    const page = await client.call("searchStaffOrders", {
      query: { status: "printed", limit: 50 },
    });
    list = [...page.items].sort((a, b) => a.orderNumber - b.orderNumber);
    wake();
  };
  watchAndRefetch(world, "/api/staff/events", refetch, world.abort.signal);

  while (!world.abort.signal.aborted) {
    const candidate = list.shift();
    if (!candidate) {
      // 一覧が空：通知か、1 秒（実際）のどちらか早いほうまで待って、取り直す
      await new Promise<void>((resolve) => {
        wake = resolve;
        setTimeout(resolve, 1000);
      });
      try {
        await refetch();
      } catch {
        // 取り直しの失敗は、呼び出しの記録に残る
      }
      continue;
    }
    const record = world.orders.find((o) => o.orderNumber === candidate.orderNumber);
    try {
      await client.call("assembleOrder", { params: { orderId: candidate.id } });
    } catch (error) {
      // 別の組み立て係が、先に取った（ふつうに起きる取り合い）
      if (error instanceof ApiClientError && error.code === "INVALID_TRANSITION") {
        countExpected(world, "組み立ての取り合い（別の人が先に取った）");
        continue;
      }
      throw error;
    }
    const started = clock.virtualNow();
    if (record) {
      mark(world, record, "assembling");
      if (record.at.printed !== undefined) {
        world.waits.assembly.push(started - record.at.printed);
      }
    }
    await clock.sleep(jitter(world.random, config.assembleServiceSeconds));
    try {
      await client.call("completeOrder", { params: { orderId: candidate.id } });
      if (record) mark(world, record, "ready");
    } catch (error) {
      if (record) fail(record, error);
    }
    world.busySeconds.assembler += clock.virtualNow() - started;
  }
}

/** 受け渡し係：列の先頭の来場者の注文を探し、確認コードで受け渡す。確認コードを、最初に打ち間違える人もいる */
export async function pickupDesk(world: World, desks: Desks): Promise<void> {
  const { config, clock } = world;
  const client = makeClient(world);
  watchAndRefetch(
    world,
    "/api/staff/events",
    async () => {
      await client.call("searchStaffOrders", { query: { status: "ready", limit: 50 } });
    },
    world.abort.signal,
  );
  for (;;) {
    const task = await desks.pickup.take();
    if (!task || world.abort.signal.aborted) return;
    const { order } = task;
    world.waits.pickup.push(clock.virtualNow() - task.enqueuedAt);
    const started = clock.virtualNow();
    try {
      const orderId = order.orderId;
      const code = order.code;
      if (!orderId || !code) throw new Error("注文の情報がありません");
      await client.call("searchStaffOrders", { query: { q: orderId, limit: 1 } });
      await clock.sleep(jitter(world.random, config.pickupServiceSeconds));
      if (world.random() < config.mistypeRate) {
        try {
          await client.call("pickupOrder", {
            params: { orderId },
            body: { confirmationCode: code === "ZZZZ" ? "2222" : "ZZZZ" },
          });
          throw new Error("間違った確認コードで、受け渡せてしまいました");
        } catch (error) {
          if (error instanceof ApiClientError && error.code === "CONFIRMATION_MISMATCH") {
            countExpected(world, "確認コードの打ち間違い（拒否されて、やり直し）");
          } else {
            throw error;
          }
        }
      }
      await client.call("pickupOrder", { params: { orderId }, body: { confirmationCode: code } });
      mark(world, order, "picked_up");
      order.finished = true;
    } catch (error) {
      fail(order, error);
    } finally {
      world.busySeconds.pickup += clock.virtualNow() - started;
      task.done();
    }
  }
}

/** 呼び出しモニター：通知が来るたびに、できあがりの一覧を取り直す */
export function monitor(world: World): void {
  const client = makeClient(world);
  watchAndRefetch(
    world,
    "/api/monitor/events",
    async () => {
      await client.call("getMonitorReady");
    },
    world.abort.signal,
  );
}

/** 各状態の件数を、一定の間隔で記録する（ピーク・詰まりの推移を見る） */
export function sampler(world: World, desks: Desks, everyMs = 500): { stop: () => void } {
  const timer = setInterval(() => {
    const counts = (stage: Stage) =>
      world.orders.filter((o) => o.at[stage] !== undefined && !o.finished).length;
    // 各状態に「いる」件数：その状態になった時刻があり、次の状態にはまだなっていないもの
    const inStage = (stage: Stage) => {
      const index = STATUS_ORDER.indexOf(stage);
      const next = STATUS_ORDER[index + 1];
      return world.orders.filter(
        (o) => o.at[stage] !== undefined && (next === undefined || o.at[next] === undefined),
      ).length;
    };
    void counts;
    world.samples.push({
      t: world.clock.virtualNow(),
      waitingPay: inStage("submitted"),
      waitingPrint: inStage("paid"),
      waitingAssembly: inStage("printed"),
      assembling: inStage("assembling"),
      ready: inStage("ready"),
      done: world.orders.filter((o) => o.finished).length,
      boothQueue: desks.booth.length,
      pickupQueue: desks.pickup.length,
    });
  }, everyMs);
  return { stop: () => clearInterval(timer) };
}
