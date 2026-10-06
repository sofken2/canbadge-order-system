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
 * orderItemIds の並びが、そのまま PDF 上の位置になる。
 * copies は、各バッジを用紙に何個並べるか（個数。省略すると、すべて 1 個）。位置（position）は、
 * そのバッジの最初の 1 個の、用紙の何番目か（0 から）。例：copies が [2, 1] なら、位置は 0 と 2
 * （用紙の 1・2 番目が最初のバッジ、3 番目が次のバッジ）。
 * **印刷中のシートがあるときは、作れない**（同時に印刷中にできるのは 1 枚まで。印刷係の確認が済むまで、次を送らない）。
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
        "印刷中のシートがあります。印刷係の確認が済んでから、次のシートを作ります",
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
