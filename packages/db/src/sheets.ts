import {
  type Actor,
  type PrintSheet,
  type PrintSheetStatus,
  type PrintSlot,
  printSheetStatusLabels,
  printSheetTransitions,
  relativePathSchema,
} from "@canbadge/shared";
import { and, eq } from "drizzle-orm";
import { writeAudit } from "./audit";
import type { Database } from "./connection";
import { conflict, DbError, validationFailed } from "./errors";
import { applyItemTransition } from "./items";
import { listPrintSlots, requirePrintSheet } from "./queries";
import { printSheets, printSlots } from "./schema";
import { type Ctx, idAt, write } from "./transaction";
import { findTransition } from "./transition";

export type PrintSheetWithSlots = { sheet: PrintSheet; slots: PrintSlot[] };

/**
 * 印刷シートを作る。シートと、載せるバッジの状態（印刷中）を、印刷を始める**前に**記録する。
 * こうしておけば、印刷の途中で処理 PC が再起動しても、二重に印刷されない（印刷中のまま残り、起動時に、印刷済みとして扱う）。
 * orderItemIds の並びが、そのまま PDF 上の位置になる。
 * copies は、各バッジを用紙に何個並べるか（個数。省略すると、すべて 1 個）。位置（position）は、
 * そのバッジの最初の 1 個の、用紙の何番目か（0 から）。例：copies が [2, 1] なら、位置は 0 と 2
 * （用紙の 1・2 番目が最初のバッジ、3 番目が次のバッジ）。
 * **印刷中のシートがあるときは、作れない**（同時に印刷中にできるのは 1 枚まで。いまのシートの印刷が終わるまで、次を送らない）。
 * 1 つでも印刷できないバッジがあれば、全体を取り消す
 */
export function createPrintSheet(
  db: Database,
  input: { pdfPath: string; orderItemIds: string[]; copies?: number[] },
): PrintSheetWithSlots {
  const path = relativePathSchema.safeParse(input.pdfPath);
  if (!path.success) throw validationFailed("PDF のパスが正しくありません");
  if (input.orderItemIds.length === 0) throw validationFailed("載せるバッジがありません");
  if (new Set(input.orderItemIds).size !== input.orderItemIds.length) {
    throw validationFailed("同じバッジを 2 回載せることはできません");
  }
  const copies = input.copies ?? input.orderItemIds.map(() => 1);
  if (
    copies.length !== input.orderItemIds.length ||
    copies.some((n) => !Number.isInteger(n) || n < 1)
  ) {
    throw validationFailed("バッジごとの個数が正しくありません");
  }

  return write(db, (ctx) => {
    // 確認と作成を、同じトランザクションで行う。印刷係のいない間に、2 つの worker が、それぞれ別のシートを
    // 作ってしまうのを防ぐ
    const printing = ctx.tx
      .select({ id: printSheets.id })
      .from(printSheets)
      .where(eq(printSheets.status, "printing"))
      .limit(1)
      .get();
    if (printing) {
      throw new DbError(
        "CONFLICT",
        "印刷中のシートがあります。印刷が終わってから、次のシートを作ります",
        { sheetId: printing.id },
      );
    }

    const sheetId = idAt(ctx);
    ctx.tx
      .insert(printSheets)
      .values({ id: sheetId, pdfPath: path.data, status: "printing", printedAt: ctx.at })
      .run();

    let position = 0;
    input.orderItemIds.forEach((orderItemId, index) => {
      applyItemTransition(ctx, {
        itemId: orderItemId,
        to: "printing",
        actor: "system",
        detail: { sheetId },
      });
      ctx.tx.insert(printSlots).values({ sheetId, position, orderItemId, result: "pending" }).run();
      position += copies[index] ?? 1;
    });

    writeAudit(ctx, {
      actor: "system",
      action: "print_sheet.create",
      targetType: "print_sheet",
      targetId: sheetId,
      detail: { orderItemIds: input.orderItemIds, copies },
    });
    return { sheet: requirePrintSheet(ctx.tx, sheetId), slots: listPrintSlots(ctx.tx, sheetId) };
  });
}

function applySheetTransition(
  ctx: Ctx,
  input: { sheetId: string; to: PrintSheetStatus; actor: Actor; detail?: Record<string, unknown> },
): PrintSheet {
  const sheet = requirePrintSheet(ctx.tx, input.sheetId);
  findTransition(printSheetTransitions, printSheetStatusLabels, {
    from: sheet.status,
    to: input.to,
    actor: input.actor,
  });
  const updated = ctx.tx
    .update(printSheets)
    .set({ status: input.to, checkedAt: ctx.at })
    .where(and(eq(printSheets.id, sheet.id), eq(printSheets.status, sheet.status)))
    .returning({ id: printSheets.id })
    .all();
  if (updated.length === 0) throw conflict("印刷シート");

  writeAudit(ctx, {
    actor: input.actor,
    action: "print_sheet.transition",
    targetType: "print_sheet",
    targetId: sheet.id,
    detail: { from: sheet.status, to: input.to, ...input.detail },
  });
  return requirePrintSheet(ctx.tx, sheet.id);
}

/** 印刷シートの状態を変える（遷移表のとおりに） */
export function transitionPrintSheet(
  db: Database,
  input: { sheetId: string; to: PrintSheetStatus; actor: Actor },
): PrintSheet {
  return write(db, (ctx) => applySheetTransition(ctx, input));
}

/**
 * 印刷が終わった（ドライバーが、印刷のジョブを送れた）。print-worker が呼ぶ。印刷の確認の操作は、ない。
 * - シートのバッジは、すべて印刷済みになり、注文の全バッジが印刷済みになれば、注文は自動で組み立て中に進む
 * - シートは確認済みになる。足りないバッジは、履歴からバッジごとに、すぐ再印刷できる
 */
export function completePrintSheet(
  db: Database,
  input: { sheetId: string; actor?: Actor; detail?: Record<string, unknown> },
): PrintSheetWithSlots {
  const actor = input.actor ?? "system";
  return write(db, (ctx) => {
    const sheet = requirePrintSheet(ctx.tx, input.sheetId);
    if (sheet.status !== "printing") {
      throw new DbError("INVALID_TRANSITION", "このシートは、すでに印刷が終わっています", {
        status: sheet.status,
      });
    }
    for (const slot of listPrintSlots(ctx.tx, sheet.id)) {
      applyItemTransition(ctx, {
        itemId: slot.orderItemId,
        to: "printed",
        actor,
        detail: { sheetId: sheet.id },
      });
      ctx.tx
        .update(printSlots)
        .set({ result: "ok" })
        .where(and(eq(printSlots.sheetId, sheet.id), eq(printSlots.position, slot.position)))
        .run();
    }
    applySheetTransition(ctx, { sheetId: sheet.id, to: "confirmed", actor, detail: input.detail });
    return { sheet: requirePrintSheet(ctx.tx, sheet.id), slots: listPrintSlots(ctx.tx, sheet.id) };
  });
}

/**
 * 印刷に失敗した（ドライバーが、印刷のジョブを送れなかった）。print-worker が呼ぶ。
 * シートのバッジは、印刷待ちに戻り（次のシートの先頭に優先して載る）、シートは失敗になる
 */
export function failPrintSheet(
  db: Database,
  input: { sheetId: string; actor?: Actor; detail?: Record<string, unknown> },
): PrintSheetWithSlots {
  const actor = input.actor ?? "system";
  return write(db, (ctx) => {
    const sheet = requirePrintSheet(ctx.tx, input.sheetId);
    if (sheet.status !== "printing") {
      throw new DbError("INVALID_TRANSITION", "このシートは、すでに印刷が終わっています", {
        status: sheet.status,
      });
    }
    for (const slot of listPrintSlots(ctx.tx, sheet.id)) {
      applyItemTransition(ctx, {
        itemId: slot.orderItemId,
        to: "queued",
        actor,
        detail: { sheetId: sheet.id },
      });
      ctx.tx
        .update(printSlots)
        .set({ result: "reprint" })
        .where(and(eq(printSlots.sheetId, sheet.id), eq(printSlots.position, slot.position)))
        .run();
    }
    applySheetTransition(ctx, { sheetId: sheet.id, to: "failed", actor, detail: input.detail });
    return { sheet: requirePrintSheet(ctx.tx, sheet.id), slots: listPrintSlots(ctx.tx, sheet.id) };
  });
}

/**
 * 印刷キューが、バッジを印刷から外したことを、操作ログに残す（画像が読めないなど）。
 * バッジは印刷待ちのまま。誰かが気づいて、原因（画像）を直せるよう、記録だけを残す
 */
export function recordPrintSkip(
  db: Database,
  input: { orderItemId: string; orderNumber: number; reason: string },
): void {
  write(db, (ctx) => {
    writeAudit(ctx, {
      actor: "system",
      action: "print.skip",
      targetType: "order_item",
      targetId: input.orderItemId,
      detail: { orderNumber: input.orderNumber, reason: input.reason },
    });
  });
}
