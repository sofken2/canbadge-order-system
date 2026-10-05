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
 * こうしておけば、印刷の途中で処理 PC が再起動しても、二重に印刷されず、確認待ちとして残る。
 * orderItemIds の並びが、そのまま PDF 上の位置（0 始まり）になる。
 * 1 つでも印刷できないバッジがあれば、全体を取り消す
 */
export function createPrintSheet(
  db: Database,
  input: { pdfPath: string; orderItemIds: string[] },
): PrintSheetWithSlots {
  const path = relativePathSchema.safeParse(input.pdfPath);
  if (!path.success) throw validationFailed("PDF のパスが正しくありません");
  if (input.orderItemIds.length === 0) throw validationFailed("載せるバッジがありません");
  if (new Set(input.orderItemIds).size !== input.orderItemIds.length) {
    throw validationFailed("同じバッジを 2 回載せることはできません");
  }

  return write(db, (ctx) => {
    const sheetId = idAt(ctx);
    ctx.tx
      .insert(printSheets)
      .values({ id: sheetId, pdfPath: path.data, status: "printing", printedAt: ctx.at })
      .run();

    input.orderItemIds.forEach((orderItemId, position) => {
      applyItemTransition(ctx, {
        itemId: orderItemId,
        to: "printing",
        actor: "system",
        detail: { sheetId },
      });
      ctx.tx.insert(printSlots).values({ sheetId, position, orderItemId, result: "pending" }).run();
    });

    writeAudit(ctx, {
      actor: "system",
      action: "print_sheet.create",
      targetType: "print_sheet",
      targetId: sheetId,
      detail: { orderItemIds: input.orderItemIds },
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

/** 印刷シートの状態を変える。紙詰まりなどで、用紙ごとやり直すとき（failed）に使う */
export function transitionPrintSheet(
  db: Database,
  input: { sheetId: string; to: PrintSheetStatus; actor: Actor },
): PrintSheet {
  return write(db, (ctx) => applySheetTransition(ctx, input));
}

/**
 * 印刷の確認。印刷係が用紙を見て、バッジごとに OK か再印刷を選んで確定する。
 * - OK のバッジは印刷済みに、再印刷のバッジは印刷待ちに戻る（次のシートに載る）
 * - 注文の全バッジが印刷済みになれば、注文は自動で印刷済みに進む
 * - シートは確認済みになる。全部を再印刷に回したとき（紙詰まりなど）だけ、失敗になる
 */
export function checkPrintSheet(
  db: Database,
  input: { sheetId: string; reprintOrderItemIds: string[]; actor: Actor },
): PrintSheetWithSlots {
  return write(db, (ctx) => {
    const sheet = requirePrintSheet(ctx.tx, input.sheetId);
    if (sheet.status !== "printing") {
      throw new DbError("INVALID_TRANSITION", "このシートは、すでに確認済みです", {
        status: sheet.status,
      });
    }
    const slots = listPrintSlots(ctx.tx, sheet.id);
    const onSheet = new Set(slots.map((slot) => slot.orderItemId));
    const reprint = new Set(input.reprintOrderItemIds);
    for (const id of reprint) {
      if (!onSheet.has(id))
        throw validationFailed("このシートに載っていないバッジが含まれています");
    }

    for (const slot of slots) {
      const toReprint = reprint.has(slot.orderItemId);
      applyItemTransition(ctx, {
        itemId: slot.orderItemId,
        to: toReprint ? "queued" : "printed",
        actor: input.actor,
        detail: { sheetId: sheet.id },
      });
      ctx.tx
        .update(printSlots)
        .set({ result: toReprint ? "reprint" : "ok" })
        .where(and(eq(printSlots.sheetId, sheet.id), eq(printSlots.position, slot.position)))
        .run();
    }

    const allReprint = slots.length > 0 && slots.every((slot) => reprint.has(slot.orderItemId));
    applySheetTransition(ctx, {
      sheetId: sheet.id,
      to: allReprint ? "failed" : "confirmed",
      actor: input.actor,
      detail: { reprintOrderItemIds: [...reprint] },
    });
    return { sheet: requirePrintSheet(ctx.tx, sheet.id), slots: listPrintSlots(ctx.tx, sheet.id) };
  });
}
