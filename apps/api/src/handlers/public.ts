import {
  countWaitingOrders,
  createOrder,
  getOrder,
  getOrderByNumber,
  getSetting,
  transitionOrder,
} from "@canbadge/db";
import type { Context } from "hono";
import { ensureAnonToken, readAnonToken } from "../anon";
import { ApiException, notFound, validationFailed } from "../errors";
import { findImage, saveUploadedImage } from "../images";
import type { HandlersFor } from "../register";
import { buildOrderView } from "../views";
import { subscribeSse } from "./sse";

// 来場者向け（認証なし）。本人の判定は匿名トークンの Cookie で行う。
// Turnstile の検証・端末あたりの上限・照会の試行回数の制限は A06、画像の本格的な検証は A02 で入れる。

export const publicHandlers: HandlersFor<
  | "getStatus"
  | "uploadImage"
  | "getImage"
  | "createOrder"
  | "getOrder"
  | "lookupOrder"
  | "cancelOrder"
  | "discordAuthorize"
  | "discordCallback"
  | "orderEvents"
> = {
  getStatus: ({ deps }) => {
    const setting = getSetting(deps.db.orm);
    return {
      acceptance: setting.acceptance,
      busyMessage: setting.busyMessage,
      price: setting.price,
      maxQuantityPerOrder: setting.maxQuantityPerOrder,
      waitingCount: countWaitingOrders(deps.db),
    };
  },

  uploadImage: async ({ c, deps }) => {
    const form = await c.req.parseBody().catch(() => ({}) as Record<string, unknown>);
    const file = form.file;
    if (!(file instanceof File)) {
      throw validationFailed("画像のファイルを送ってください（フィールド名は file）");
    }
    const imageId = await saveUploadedImage(
      deps.dataDir,
      file,
      getSetting(deps.db.orm).imageMaxBytes,
    );
    return { imageId };
  },

  getImage: ({ deps, params }) => {
    // サムネイルは A02 で作る。それまでは、元の画像をそのまま返す
    const image = findImage(deps.dataDir, params.imageId);
    if (!image) throw notFound("画像");
    return new Response(Bun.file(image.path), {
      headers: { "content-type": image.contentType, "x-content-type-options": "nosniff" },
    });
  },

  createOrder: ({ c, deps, body }) => {
    const image = findImage(deps.dataDir, body.imageId);
    if (!image) throw validationFailed("画像が見つかりません。もう一度アップロードしてください");
    // body.turnstileToken の検証は A06
    const { order } = createOrder(deps.db, {
      imagePath: `images/${body.imageId}.${image.extension}`,
      editorData: body.editorData,
      quantity: body.quantity,
      anonToken: ensureAnonToken(c),
    });
    return { orderId: order.id };
  },

  getOrder: ({ deps, params }) => {
    // 注文 ID は推測できない長い ID なので、知っている人（QR や URL を持つ本人）だけが開ける
    const order = getOrder(deps.db.orm, params.orderId);
    if (!order) throw notFound("注文");
    return buildOrderView(deps.db, order);
  },

  lookupOrder: ({ deps, body }) => {
    const { businessDate } = getSetting(deps.db.orm);
    const order = businessDate
      ? getOrderByNumber(deps.db.orm, businessDate, body.orderNumber)
      : undefined;
    // 番号と確認コードのどちらが違うかは、教えない
    if (!order || order.confirmationCode !== body.confirmationCode) throw notFound("注文");
    return { orderId: order.id };
  },

  cancelOrder: ({ c, deps, params }) => {
    const order = getOrder(deps.db.orm, params.orderId);
    // 本人（注文したときの匿名トークンの持ち主）だけが取り消せる。違えば、存在しないものとして扱う
    const token = readAnonToken(c);
    if (!order || token === undefined || token !== order.anonToken) throw notFound("注文");
    const cancelled = transitionOrder(deps.db, {
      orderId: order.id,
      to: "cancelled",
      actor: "visitor",
    });
    return buildOrderView(deps.db, cancelled);
  },

  // Discord アイコンの取り込みは W08 で実装する
  discordAuthorize: ({ c }) => notImplemented(c),
  discordCallback: ({ c }) => notImplemented(c),

  orderEvents: ({ c, deps, params }) =>
    subscribeSse(
      c,
      deps,
      (event) => event.type === "order.updated" && event.orderId === params.orderId,
    ),
};

function notImplemented(c: Context): Response {
  const error = new ApiException(
    "INTERNAL",
    "Discord アイコンの取り込みは、まだ実装されていません（W08）",
  );
  return c.json({ error: { code: error.code, message: error.message } }, 501);
}
