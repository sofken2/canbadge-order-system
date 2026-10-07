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
  sheetsDir,
} from "@canbadge/db";
import { formatOrderNumber } from "@canbadge/shared";
import type { PrintDriver } from "./driver";
import { renderSheetPdf } from "./sheet-pdf";

// 印刷キューの最小限。**本番のキュー制御（一時停止中の扱い・再起動後の復旧・再印刷の細かい順序など）は
// P02、本番のドライバーは P03 で作る。** PDF は、P01 の面付け（sheet-pdf.ts）で作る。 ここは、注文から呼び出しまでを
// 一通り通す（T09）ための、骨組み。

export type QueueOptions = {
  dataDir: string;
  driver: PrintDriver;
  /** 1 枚に載せる数。省略すると、badge-spec の面付け数 */
  slots?: number;
  /** 「最も古いバッジが待つ時間」を、設定（printMaxWaitSeconds）の代わりにこの秒数にする（開発用） */
  waitOverrideSeconds?: number;
  log?: (message: string) => void;
};

export type TickResult =
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

/** 日本時間の「2026-11-03 20:40」。用紙に印字する */
const jstMinute = (date: Date): string =>
  new Date(date.getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 16).replace("T", " ");

const errorText = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

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

  const candidates = listPrintableItems(db);
  if (candidates.length === 0) return { status: "empty" };

  const capacity = options.slots ?? slotsPerSheet(badgeSpec);
  const waitSeconds = options.waitOverrideSeconds ?? setting.printMaxWaitSeconds;
  const oldest = Math.min(...candidates.map((item) => new Date(item.waitingSince).getTime()));
  const waitedSeconds = (db.now().getTime() - oldest) / 1000;
  if (candidates.length < capacity && waitedSeconds < waitSeconds) return { status: "waiting" };

  const batch = candidates.slice(0, capacity);
  const key = newId(db.now());
  const pdfPath = join(sheetsDir(options.dataDir), `${key}.pdf`);
  mkdirSync(sheetsDir(options.dataDir), { recursive: true });
  try {
    await Bun.write(
      pdfPath,
      await renderSheetPdf(
        badgeSpec,
        batch.map((item) => ({
          imagePath: item.imagePath,
          orderNumberText: formatOrderNumber(item.orderNumber, setting.orderNumberDigits),
        })),
        {
          dataDir: options.dataDir,
          // 用紙と、S03 の画面（「20:40 に印刷」）を、見比べるための手がかり
          sheetLabel: `SHEET ${key.slice(-6)}`,
          printedAtText: jstMinute(db.now()),
        },
      ),
    );
  } catch (error) {
    // 画像が読めないなど。シートは記録していないので、バッジは印刷待ちのまま（P02 で、問題のバッジを避ける）
    return { status: "failed", error: errorText(error) };
  }

  // 印刷する前に、シートとバッジの状態を記録する
  let sheetId: string;
  try {
    sheetId = createPrintSheet(db, {
      pdfPath: `sheets/${key}.pdf`,
      orderItemIds: batch.map((item) => item.orderItemId),
    }).sheet.id;
  } catch (error) {
    // 巡回の間に、注文が返金されたなどで、載せられなくなった。PDF を捨てて、次の巡回でやり直す
    rmSync(pdfPath, { force: true });
    return { status: "failed", error: errorText(error) };
  }

  try {
    await options.driver.print({ sheetId, pdfPath });
  } catch (error) {
    options.log?.(`印刷に失敗しました（シート ${sheetId}）: ${errorText(error)}`);
    return { status: "driver-failed", sheetId, error: errorText(error) };
  }
  return { status: "printed", sheetId, orderNumbers: batch.map((item) => item.orderNumber) };
}

/** 印刷キューを、一定の間隔で巡回し続ける。巡回が終わる前に次の巡回は始めない */
export function startQueueLoop(
  db: Database,
  options: QueueOptions,
  intervalMs: number,
): { stop: () => void } {
  let running = false;
  const timer = setInterval(async () => {
    if (running) return;
    running = true;
    try {
      const result = await runQueueOnce(db, options);
      if (result.status === "printed") {
        options.log?.(
          `シート ${result.sheetId} を ${options.driver.name} ドライバーで印刷しました（注文 ${result.orderNumbers.join(", ")}）`,
        );
      } else if (result.status === "failed") {
        options.log?.(`シートを作れませんでした: ${result.error}`);
      }
    } catch (error) {
      options.log?.(`印刷キューでエラーが起きました: ${errorText(error)}`);
    } finally {
      running = false;
    }
  }, intervalMs);
  return { stop: () => clearInterval(timer) };
}
