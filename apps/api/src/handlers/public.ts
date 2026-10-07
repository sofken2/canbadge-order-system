import {
  countPendingOrders,
  countWaitingOrders,
  createOrder,
  getOrder,
  getOrderByNumber,
  getSetting,
  transitionOrder,
} from "@canbadge/db";
import type { Context } from "hono";
import { assertNotLimited, enforce, visitorIp } from "../abuse";
import { ensureAnonToken, readAnonToken } from "../anon";
import { ApiException, notFound, validationFailed } from "../errors";
import { findImage, saveUploadedImage } from "../images";
import type { HandlersFor } from "../register";
import { buildOrderView } from "../views";
import { subscribeSse } from "./sse";

// 来場者向け（認証なし）。本人の判定は匿名トークンの Cookie で行う。
// Turnstile の検証・端末あたりの上限・回数の制限は A06、画像の本格的な検証は A02 で入れる。

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
    enforce(
      deps.abuse.uploads,
      visitorIp(c, deps.remoteAddressOf?.(c)),
      (wait) =>
        `画像を、短い間に、たくさん送っています。${wait}ほど待ってから、もう一度お試しください`,
    );
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

  createOrder: async ({ c, deps, body }) => {
    const ip = visitorIp(c, deps.remoteAddressOf?.(c));
    enforce(
      deps.abuse.orders,
      ip,
      (wait) =>
        `注文を、短い間に、たくさん出しています。${wait}ほど待ってから、もう一度お試しください`,
    );

    const image = findImage(deps.dataDir, body.imageId);
    if (!image) throw validationFailed("画像が見つかりません。もう一度アップロードしてください");

    // Turnstile のトークンは 1 回しか使えないので、断られる注文（受付停止・上限）では、先に使わせない。
    // ここは先回りの確認で、最終的な判定は、注文を作るトランザクションの中（db）が行う
    const setting = getSetting(deps.db.orm);
    if (setting.acceptance !== "open" || setting.businessDate === null) {
      throw new ApiException(
        "NOT_ACCEPTING",
        setting.busyMessage ?? "現在、注文を受け付けていません",
        { acceptance: setting.acceptance, busyMessage: setting.busyMessage },
      );
    }
    const token = ensureAnonToken(c);
    if (countPendingOrders(deps.db.orm, token) >= setting.maxPendingPerDevice) {
      throw new ApiException(
        "RATE_LIMITED",
        `支払い待ちの注文が ${setting.maxPendingPerDevice} 件あります。レジで支払うか、取り消してから、注文してください`,
      );
    }

    // Turnstile の検証（サーバー側）。未設定の開発環境だけ、検証しない
    if (deps.turnstile) {
      const result = await deps.turnstile.verify(body.turnstileToken, ip);
      if (!result.ok) {
        // 理由は、ログにだけ残す（画面には、ボット判定の仕組みの詳細を見せない）
        console.warn(`api: Turnstile の検証に失敗しました（${result.reason}）`);
        throw result.transient
          ? new ApiException(
              "INTERNAL",
              "ボット対策の確認が、いま使えません。少し待ってから、もう一度お試しください",
            )
          : new ApiException(
              "VALIDATION_FAILED",
              "確認に失敗しました。画面の確認をやり直してから、もう一度、注文してください",
              { reason: "turnstile" },
            );
      }
    }

    const { order } = createOrder(deps.db, {
      imagePath: `images/${body.imageId}.${image.extension}`,
      editorData: body.editorData,
      quantity: body.quantity,
      anonToken: token,
    });
    return { orderId: order.id };
  },

  getOrder: ({ deps, params }) => {
    // 注文 ID は推測できない長い ID なので、知っている人（QR や URL を持つ本人）だけが開ける
    const order = getOrder(deps.db.orm, params.orderId);
    if (!order) throw notFound("注文");
    return buildOrderView(deps.db, order);
  },

  lookupOrder: ({ c, deps, body }) => {
    const ip = visitorIp(c, deps.remoteAddressOf?.(c));
    const tryLater = (wait: string) =>
      `確認コードを、何度も間違えています。${wait}ほど待ってから、もう一度お試しください`;

    // 確認コード（4 文字）の総当たりを止める。失敗の数は、IP ごとと、注文番号ごと（IP を変えても止まる）に数える
    enforce(
      deps.abuse.lookups,
      ip,
      (wait) => `照会が多すぎます。${wait}ほど待ってから、もう一度お試しください`,
    );
    assertNotLimited(deps.abuse.lookupFailuresByIp, ip, tryLater);
    assertNotLimited(deps.abuse.lookupFailuresByNumber, String(body.orderNumber), tryLater);

    const { businessDate } = getSetting(deps.db.orm);
    const order = businessDate
      ? getOrderByNumber(deps.db.orm, businessDate, body.orderNumber)
      : undefined;
    // 番号と確認コードのどちらが違うかは、教えない
    if (!order || order.confirmationCode !== body.confirmationCode) {
      // 存在しない番号の失敗も数える（番号が存在するかどうかを、回数の違いから、探られないように）
      deps.abuse.lookupFailuresByIp.hit(ip);
      deps.abuse.lookupFailuresByNumber.hit(String(body.orderNumber));
      throw notFound("注文");
    }
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
