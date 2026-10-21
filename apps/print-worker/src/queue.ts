import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { badgeSpec, slotsPerSheet } from "@canbadge/badge-spec";
import {
  createPrintSheet,
  type Database,
  getCurrentPrintSheet,
  getSetting,
  listPrintableItems,
  newId,
  type PrintableItem,
  recordPrintSkip,
  sheetsDir,
} from "@canbadge/db";
import { formatOrderNumber } from "@canbadge/shared";
import type { PrintDriver } from "./driver";
import { planSheet } from "./plan";
import { checkBadgeImage, renderSheetPdf } from "./sheet-pdf";

// 印刷キュー（P02）。印刷待ちのバッジを、用紙 1 枚ごとにまとめ、PDF を作って、ドライバーで印刷する。
//
// 守っていること：
// - 同時に印刷中にできるのは 1 枚（印刷係の確認が済むまで、次を送らない）。db も、同じことを保証する
// - シートとバッジの状態を、印刷する**前に** DB に記録する。途中で落ちても、二重には印刷されない
//   （印刷中のまま、確認待ちとして残る。再起動したあと、自動で印刷し直すことは、しない）
// - 再印刷のバッジが先、次に待った順（listPrintableItems の並び）
// - 画像が読めないなど、載せられないバッジは、外して、ほかのバッジの印刷を止めない

export type QueueOptions = {
  dataDir: string;
  driver: PrintDriver;
  /** 1 枚に載せる数。省略すると、badge-spec の面付け数 */
  slots?: number;
  /** 「最も古いバッジが待つ時間」を、設定（printMaxWaitSeconds）の代わりにこの秒数にする（開発用） */
  waitOverrideSeconds?: number;
  /** 載せられないバッジの記録。巡回をまたいで持つ。省略すると、その巡回だけ */
  skips?: SkipRegistry;
  /** 再印刷のバッジが、印刷待ちに戻った（このワーカーが、初めて見た）時刻（ms）。巡回をまたいで持つ。省略すると、その巡回だけ */
  requeuedAt?: Map<string, number>;
  log?: (message: string) => void;
};

/** 印刷から外した（載せられなかった）バッジ */
export type Skipped = { orderItemId: string; orderNumber: number; reason: string };

type TickBase =
  | { status: "printed"; sheetId: string; orderNumbers: number[] }
  /** 設定で印刷を一時停止している */
  | { status: "paused" }
  /** 印刷中のシートが、印刷係の確認を待っている（同時に印刷するのは 1 枚まで） */
  | { status: "busy" }
  /** 印刷できるバッジがない */
  | { status: "empty" }
  /** 用紙 1 枚分に足りず、待ち時間にも達していない */
  | { status: "waiting" }
  /** シートを記録できなかった（記録されていないので、次の巡回でやり直す） */
  | { status: "failed"; error: string }
  /** シートは記録済みだが、ドライバーが印刷に失敗した。印刷係が、シートの確認で再印刷を選べる */
  | { status: "driver-failed"; sheetId: string; error: string };

/** 巡回の結果。載せられなくて外したバッジがあれば、skipped に入る */
export type TickResult = TickBase & { skipped?: Skipped[] };

const errorText = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/** 日本時間の「2026-11-03 20:40」。用紙に印字する */
const jstMinute = (date: Date): string =>
  new Date(date.getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 16).replace("T", " ");

/** 外したバッジを、しばらく覚える（同じバッジを、巡回のたびに、確かめ直して、ログを埋めないため） */
export type SkipRegistry = {
  /** いま外している（待ち時間の間）か */
  has: (orderItemId: string, nowMs: number) => boolean;
  add: (orderItemId: string, nowMs: number) => void;
};

/** 外してから、この時間がたつと、もう一度、載せられるか確かめる（画像が直されたかもしれない） */
export const SKIP_COOLDOWN_MS = 15 * 60 * 1000;

export function createSkipRegistry(cooldownMs = SKIP_COOLDOWN_MS): SkipRegistry {
  const until = new Map<string, number>();
  return {
    has: (id, nowMs) => {
      const limit = until.get(id);
      if (limit === undefined) return false;
      if (nowMs >= limit) {
        until.delete(id);
        return false;
      }
      return true;
    },
    add: (id, nowMs) => {
      until.set(id, nowMs + cooldownMs);
    },
  };
}

/**
 * 印刷キューを 1 回だけ巡回する。
 * 用紙 1 枚分（面付け数）がたまったら即座に、たまらなくても最も古いバッジが一定時間待ったら、
 * そのときの分で印刷する。再印刷のバッジが先に載る。
 * シートとバッジの状態を DB に記録してから印刷するので、途中で落ちても二重には印刷されない
 */
export async function runQueueOnce(db: Database, options: QueueOptions): Promise<TickResult> {
  const setting = getSetting(db.orm);
  if (setting.printPaused) return { status: "paused" };
  if (getCurrentPrintSheet(db)) return { status: "busy" };

  const capacity = options.slots ?? slotsPerSheet(badgeSpec);
  const waitSeconds = options.waitOverrideSeconds ?? setting.printMaxWaitSeconds;
  const skips = options.skips ?? createSkipRegistry();
  const requeuedAt = options.requeuedAt ?? new Map<string, number>();
  const nowMs = db.now().getTime();
  const skipped: Skipped[] = [];

  /** 載せられないバッジを外す。初めて外したときだけ、操作ログと、ログ出力を残す */
  const skip = (item: PrintableItem, reason: string) => {
    if (skips.has(item.orderItemId, nowMs)) return;
    skips.add(item.orderItemId, nowMs);
    const entry = { orderItemId: item.orderItemId, orderNumber: item.orderNumber, reason };
    skipped.push(entry);
    recordPrintSkip(db, entry);
    options.log?.(`注文 ${item.orderNumber} のバッジを、印刷から外しました（${reason}）`);
  };
  const withSkipped = <T extends TickBase>(result: T): TickResult =>
    skipped.length > 0 ? { ...result, skipped } : result;

  // 載せるバッジを決める。画像を確かめて、読めないものは外し、決め直す（外したぶん、ほかのバッジが載る）
  let plan: ReturnType<typeof planSheet<PrintableItem>> = { status: "empty" };
  for (let attempt = 0; attempt < 10; attempt++) {
    const printable = listPrintableItems(db);
    // 再印刷のバッジは、やり直しになった時刻から、待つ（支払いの時刻では、すでに長く待ったことになってしまう）。
    // 印刷待ちに戻った時刻は、DB にないので、このワーカーが、初めて見た時刻で、代わりにする
    for (const item of printable) {
      if (item.printCount > 0 && !requeuedAt.has(item.orderItemId)) {
        requeuedAt.set(item.orderItemId, nowMs);
      }
    }
    const stillPrintable = new Set(printable.map((item) => item.orderItemId));
    for (const id of requeuedAt.keys()) if (!stillPrintable.has(id)) requeuedAt.delete(id);

    const candidates = printable
      .filter((item) => {
        if (skips.has(item.orderItemId, nowMs)) return false;
        if (item.quantity > capacity) {
          skip(item, `個数 ${item.quantity} が、1 枚に載る数（${capacity}）を超えています`);
          return false;
        }
        return true;
      })
      .map((item) => {
        const since = item.printCount > 0 ? requeuedAt.get(item.orderItemId) : undefined;
        return {
          ...item,
          reprint: item.printCount > 0,
          waitingSince: since === undefined ? item.waitingSince : new Date(since).toISOString(),
        };
      });
    plan = planSheet(candidates, { capacity, waitSeconds, nowMs });
    if (plan.status !== "print") break;

    let allReadable = true;
    for (const item of plan.batch) {
      try {
        await checkBadgeImage(options.dataDir, item.imagePath);
      } catch (error) {
        allReadable = false;
        skip(item, errorText(error));
        // 外した（または、すでに外している）ので、次の決め直しでは、候補から除かれる
        skips.add(item.orderItemId, nowMs);
      }
    }
    if (allReadable) break;
    plan = { status: "empty" };
  }

  if (plan.status === "empty") return withSkipped({ status: "empty" });
  if (plan.status === "waiting") return withSkipped({ status: "waiting" });

  const { batch, copies } = plan;
  const key = newId(db.now());
  const pdfPath = join(sheetsDir(options.dataDir), `${key}.pdf`);
  mkdirSync(sheetsDir(options.dataDir), { recursive: true });
  try {
    await Bun.write(
      pdfPath,
      await renderSheetPdf(
        badgeSpec,
        // 個数のあるバッジは、その数だけ、同じものを並べる。キラは先頭から、マグネットは末尾から数えるので、
        // 合計が個数以内なら、別々のバッジに付く（超えるぶんは、同じバッジに重なる）
        batch.flatMap((item) =>
          Array.from({ length: item.quantity }, (_, index) => ({
            imagePath: item.imagePath,
            orderNumberText: formatOrderNumber(item.orderNumber, setting.orderNumberDigits),
            kira: index < item.kiraQuantity,
            magnet: index >= item.quantity - item.magnetQuantity,
          })),
        ),
        {
          dataDir: options.dataDir,
          // 用紙と、S03 の画面（「20:40 に印刷」）を、見比べるための手がかり
          sheetLabel: `SHEET ${key.slice(-6)}`,
          printedAtText: jstMinute(db.now()),
        },
      ),
    );
  } catch (error) {
    // 事前に画像を確かめているので、ふつうは起きない。シートは記録していないので、バッジは印刷待ちのまま
    rmSync(pdfPath, { force: true });
    return withSkipped({ status: "failed", error: errorText(error) });
  }

  // 印刷する前に、シートとバッジの状態を記録する
  let sheetId: string;
  try {
    sheetId = createPrintSheet(db, {
      pdfPath: `sheets/${key}.pdf`,
      orderItemIds: batch.map((item) => item.orderItemId),
      copies,
    }).sheet.id;
  } catch (error) {
    // 巡回の間に、注文が返金されたなどで載せられなくなった、または、別の worker が先にシートを作った。
    // PDF を捨てて、次の巡回でやり直す
    rmSync(pdfPath, { force: true });
    return withSkipped({ status: "failed", error: errorText(error) });
  }

  try {
    await options.driver.print({ sheetId, pdfPath });
  } catch (error) {
    options.log?.(
      `印刷に失敗しました（シート ${sheetId}）: ${errorText(error)}。印刷係が、スタッフ画面の「印刷確認」で、再印刷を選べます`,
    );
    return withSkipped({ status: "driver-failed", sheetId, error: errorText(error) });
  }
  return withSkipped({
    status: "printed",
    sheetId,
    orderNumbers: batch.map((item) => item.orderNumber),
  });
}

/**
 * 印刷キューを、一定の間隔で巡回し続ける。巡回が終わる前に、次の巡回は始めない。
 * stop は、いま動いている巡回が終わるのを待ってから返る（印刷の記録の途中で、止めないため）
 */
export function startQueueLoop(
  db: Database,
  options: QueueOptions,
  intervalMs: number,
): { stop: () => Promise<void> } {
  const skips = options.skips ?? createSkipRegistry();
  const requeuedAt = options.requeuedAt ?? new Map<string, number>();
  const loopOptions = { ...options, skips, requeuedAt };
  let current: Promise<void> | undefined;
  let stopped = false;

  const tick = async () => {
    try {
      const result = await runQueueOnce(db, loopOptions);
      if (result.status === "printed") {
        options.log?.(
          `シート ${result.sheetId} を ${options.driver.name} ドライバーで印刷しました（注文 ${result.orderNumbers.join(", ")}）`,
        );
      } else if (result.status === "failed") {
        options.log?.(`シートを作れませんでした: ${result.error}`);
      }
    } catch (error) {
      options.log?.(`印刷キューでエラーが起きました: ${errorText(error)}`);
    }
  };

  const timer = setInterval(() => {
    if (current || stopped) return;
    current = tick().finally(() => {
      current = undefined;
    });
  }, intervalMs);

  return {
    stop: async () => {
      stopped = true;
      clearInterval(timer);
      await current;
    },
  };
}
