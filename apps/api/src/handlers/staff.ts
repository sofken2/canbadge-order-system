import { isAbsolute, join, relative, resolve } from "node:path";
import {
  businessDateOf,
  checkPrintSheet,
  getCurrentPrintSheet,
  getSetting,
  listPrintedItems,
  listPrintSheets,
  openBusinessDay,
  pickupOrder,
  reprintItems,
  requirePrintSheet,
  salesSummary,
  searchOrders,
  setAcceptance,
  setPrintPaused,
  transitionOrder,
  updateSetting,
} from "@canbadge/db";
import type { OrderStatus } from "@canbadge/shared";
import type { Deps } from "../deps";
import { notFound } from "../errors";
import type { HandlersFor } from "../register";
import { buildPrintedItemView, buildPrintSheetViews, buildStaffOrderView } from "../views";
import { subscribeSse } from "./sse";

// スタッフ向け（/api/staff/*）。認証（A05）ができるまでは、操作する人を区別せず、実行者は常に staff。
// 公開経路からは、guard.ts が断る。

/** 注文の状態を変えて、スタッフ画面向けの形で返す */
function move(deps: Deps, orderId: string, to: OrderStatus) {
  const order = transitionOrder(deps.db, { orderId, to, actor: "staff" });
  return buildStaffOrderView(deps.db, order);
}

/** データ置き場の中のファイルだけを指すパスにする（DB の値が壊れていても、外は読まない） */
function insideDataDir(dataDir: string, relativePath: string): string | undefined {
  const base = resolve(dataDir);
  const target = resolve(join(base, relativePath));
  const rel = relative(base, target);
  return rel.startsWith("..") || isAbsolute(rel) ? undefined : target;
}

export const staffHandlers: HandlersFor<
  | "searchStaffOrders"
  | "payOrder"
  | "assembleOrder"
  | "completeOrder"
  | "pickupOrder"
  | "refundOrder"
  | "cancelStaffOrder"
  | "getCurrentPrintSheet"
  | "listPrintSheets"
  | "getPrintSheetPdf"
  | "checkPrintSheet"
  | "listPrintedItems"
  | "reprint"
  | "pausePrintQueue"
  | "resumePrintQueue"
  | "openBusinessDay"
  | "setAcceptance"
  | "getSettings"
  | "updateSettings"
  | "getSales"
  | "staffEvents"
> = {
  searchStaffOrders: ({ deps, query }) => {
    const page = searchOrders(deps.db, {
      q: query.q,
      statuses: query.status,
      before: query.before,
      limit: query.limit,
    });
    return {
      items: page.items.map((order) => buildStaffOrderView(deps.db, order)),
      nextBefore: page.nextBefore,
    };
  },

  payOrder: ({ deps, params }) => move(deps, params.orderId, "paid"),
  assembleOrder: ({ deps, params }) => move(deps, params.orderId, "assembling"),
  completeOrder: ({ deps, params }) => move(deps, params.orderId, "ready"),
  refundOrder: ({ deps, params }) => move(deps, params.orderId, "refunded"),
  cancelStaffOrder: ({ deps, params }) => move(deps, params.orderId, "cancelled"),

  pickupOrder: ({ deps, params, body }) => {
    const order = pickupOrder(deps.db, {
      orderId: params.orderId,
      confirmationCode: body.confirmationCode,
      actor: "staff",
    });
    return buildStaffOrderView(deps.db, order);
  },

  getCurrentPrintSheet: ({ deps }) => {
    const sheet = getCurrentPrintSheet(deps.db);
    return { sheet: sheet ? (buildPrintSheetViews(deps.db, [sheet])[0] ?? null) : null };
  },

  listPrintSheets: ({ deps, query }) => {
    const page = listPrintSheets(deps.db, { before: query.before, limit: query.limit });
    return { items: buildPrintSheetViews(deps.db, page.items), nextBefore: page.nextBefore };
  },

  getPrintSheetPdf: ({ deps, params }) => {
    const sheet = requirePrintSheet(deps.db.orm, params.sheetId);
    const path = insideDataDir(deps.dataDir, sheet.pdfPath);
    if (!path) throw notFound("PDF");
    const file = Bun.file(path);
    return file.exists().then((exists) => {
      if (!exists) throw notFound("PDF");
      return new Response(file, { headers: { "content-type": "application/pdf" } });
    });
  },

  checkPrintSheet: ({ deps, params, body }) => {
    const result = checkPrintSheet(deps.db, {
      sheetId: params.sheetId,
      reprintOrderItemIds: body.reprintOrderItemIds,
      actor: "staff",
    });
    const view = buildPrintSheetViews(deps.db, [result.sheet])[0];
    if (!view) throw notFound("印刷シート");
    return view;
  },

  listPrintedItems: ({ deps, query }) => {
    const page = listPrintedItems(deps.db, {
      q: query.q,
      before: query.before,
      limit: query.limit,
    });
    return {
      items: page.items.map((item) => buildPrintedItemView(deps.db, item)),
      nextBefore: page.nextBefore,
    };
  },

  reprint: ({ deps, body }) =>
    reprintItems(deps.db, { orderItemIds: body.orderItemIds, actor: "staff" }),

  pausePrintQueue: ({ deps }) => {
    const setting = setPrintPaused(deps.db, { paused: true, actor: "staff" });
    return { printPaused: setting.printPaused };
  },
  resumePrintQueue: ({ deps }) => {
    const setting = setPrintPaused(deps.db, { paused: false, actor: "staff" });
    return { printPaused: setting.printPaused };
  },

  openBusinessDay: ({ deps }) => openBusinessDay(deps.db, { actor: "staff" }),
  setAcceptance: ({ deps, body }) =>
    setAcceptance(deps.db, {
      acceptance: body.acceptance,
      busyMessage: body.busyMessage,
      actor: "staff",
    }),
  getSettings: ({ deps }) => getSetting(deps.db.orm),
  updateSettings: ({ deps, body }) => updateSetting(deps.db, { values: body, actor: "staff" }),

  getSales: ({ deps, query }) => {
    const businessDate =
      query.businessDate ?? getSetting(deps.db.orm).businessDate ?? businessDateOf(deps.db.now());
    return salesSummary(deps.db, businessDate);
  },

  staffEvents: ({ c, deps }) => subscribeSse(c, deps, () => true),
};
