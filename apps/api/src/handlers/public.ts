import { timingSafeEqual } from "node:crypto";
import {
  countWaitingOrders,
  getOrder,
  getOrderByNumber,
  getSetting,
  transitionOrder,
} from "@canbadge/db";
import type { Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { assertNotLimited, enforce, visitorIp } from "../abuse";
import { readAnonToken } from "../anon";
import { DiscordError, type DiscordFailure } from "../discord";
import { ApiException, notFound, validationFailed } from "../errors";
import { findImage, findThumbnail, saveUploadedImage } from "../images";
import { placeOrder } from "../order-flow";
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

  getImage: async ({ deps, params, query }) => {
    const served =
      query.size === "thumb"
        ? await findThumbnail(deps.dataDir, params.imageId)
        : findImage(deps.dataDir, params.imageId);
    if (!served) throw notFound("画像");
    return new Response(Bun.file(served.path), {
      headers: {
        "content-type": served.contentType,
        "x-content-type-options": "nosniff",
        // 画像は、作ったあとで変わらない（ID が変わる）ので、ブラウザに、しばらく覚えさせる。共有の置き場には、置かせない
        "cache-control": "private, max-age=3600",
      },
    });
  },

  createOrder: ({ c, deps, body }) =>
    // 受付・上限・Turnstile・回数の制限は、作品からの注文と共通（order-flow.ts）
    placeOrder(c, deps, body, () => {
      const image = findImage(deps.dataDir, body.imageId);
      if (!image) throw validationFailed("画像が見つかりません。もう一度アップロードしてください");
      return {
        imagePath: `images/${body.imageId}.${image.extension}`,
        editorData: body.editorData,
      };
    }),

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

  discordAuthorize: ({ c, deps }) => {
    if (!deps.discord) {
      console.warn(
        "api: DISCORD_CLIENT_ID・DISCORD_CLIENT_SECRET・DISCORD_REDIRECT_URI が未設定です",
      );
      return backToEditor(c, { error: "unavailable" });
    }
    // 戻り先の確認用。この端末にだけ Cookie で持たせ、戻ってきたとき照合する（他人が用意した戻りを、受け付けない）
    const state = randomState();
    setCookie(c, DISCORD_STATE_COOKIE, state, {
      httpOnly: true,
      // Discord から、リンクで戻ってくる（外のサイトからの GET）ので、Lax。Strict だと Cookie が付かない
      sameSite: "Lax",
      path: "/api/discord",
      maxAge: 10 * 60,
      secure: c.req.header("x-forwarded-proto") === "https",
    });
    return c.redirect(deps.discord.authorizeUrl(state), 302);
  },

  discordCallback: async ({ c, deps, query }) => {
    const expected = getCookie(c, DISCORD_STATE_COOKIE);
    // state は、使い切り（成功・失敗にかかわらず、ここで捨てる）
    deleteCookie(c, DISCORD_STATE_COOKIE, { path: "/api/discord" });

    if (query.error) {
      return backToEditor(c, { error: query.error === "access_denied" ? "denied" : "unavailable" });
    }
    if (!deps.discord) return backToEditor(c, { error: "unavailable" });
    if (!expected || !query.state || !sameText(expected, query.state) || !query.code) {
      return backToEditor(c, { error: "state" });
    }

    try {
      enforce(deps.abuse.uploads, visitorIp(c, deps.remoteAddressOf?.(c)), () => "");
    } catch {
      return backToEditor(c, { error: "rate" });
    }

    try {
      const bytes = await deps.discord.fetchAvatar(query.code);
      // 持ち込みの画像と、同じ検証・保存を通す（形式・容量・読めるか・サムネイル）
      const imageId = await saveUploadedImage(
        deps.dataDir,
        new File([bytes as Uint8Array<ArrayBuffer>], "discord-avatar.png", { type: "image/png" }),
        getSetting(deps.db.orm).imageMaxBytes,
      );
      return backToEditor(c, { imageId });
    } catch (error) {
      // 理由は、ログにだけ残す。Discord の ID・トークン・code は、含まれない
      const reason: DiscordFailure =
        error instanceof DiscordError
          ? error.reason
          : error instanceof ApiException
            ? "image"
            : "unavailable";
      console.warn(
        `api: Discord のアイコンを取り込めませんでした（${reason}）`,
        error instanceof Error ? error.message : "",
      );
      return backToEditor(c, { error: reason });
    }
  },

  orderEvents: ({ c, deps, params }) =>
    subscribeSse(
      c,
      deps,
      (event) => event.type === "order.updated" && event.orderId === params.orderId,
    ),
};

const DISCORD_STATE_COOKIE = "discord_state";

/** 戻り先（注文画面）。成功なら imageId、失敗なら discordError を付ける。画面が、読み取ってから、URL から消す */
function backToEditor(
  c: Context,
  result: { imageId: string } | { error: DiscordFailure },
): Response {
  const query = "imageId" in result ? `imageId=${result.imageId}` : `discordError=${result.error}`;
  return c.redirect(`/?${query}`, 302);
}

const randomState = (): string =>
  Array.from(crypto.getRandomValues(new Uint8Array(24)), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");

/** 長さが違っても、同じ時間で比べる（Cookie の state を、探られないように） */
function sameText(a: string, b: string): boolean {
  const left = new TextEncoder().encode(a);
  const right = new TextEncoder().encode(b);
  return left.length === right.length && timingSafeEqual(left, right);
}
