import { countPendingOrders, createOrder, getSetting } from "@canbadge/db";
import type { EditorData } from "@canbadge/shared";
import type { Context } from "hono";
import { enforce, visitorIp } from "./abuse";
import { ensureAnonToken } from "./anon";
import type { Deps } from "./deps";
import { ApiException } from "./errors";

/** 注文の元になるもの。画像のパスと、編集データ。作品からの注文なら、元の作品の ID も */
export type OrderSource = {
  imagePath: string;
  editorData: EditorData;
  sourceArchiveEntryId?: string;
};

/**
 * 来場者の注文を確定する。通常の注文と、作品からの注文（アーカイブ）が、同じ処理を通る
 * （片方だけ、受付・上限・Turnstile・回数の制限を、すり抜けないように）。
 *
 * resolveSource は、注文の元（画像・作品）を調べて返す。断るときは、例外を投げる。
 * Turnstile の確認（await）の間に、画像が掃除されたり、作品が非公開になったりしないよう、確認のあとに、もう一度呼ぶ
 * （呼んでから注文を作るまでは、await がないので、掃除（同期）は、割り込めない。作品の公開状態は、db が、注文を作る
 * トランザクションの中で、最終的に確かめる）
 */
export async function placeOrder(
  c: Context,
  deps: Deps,
  request: {
    quantity: number;
    kiraQuantity: number;
    magnetQuantity: number;
    turnstileToken: string;
  },
  resolveSource: () => OrderSource,
): Promise<{ orderId: string }> {
  const ip = visitorIp(c, deps.remoteAddressOf?.(c));
  enforce(
    deps.abuse.orders,
    ip,
    (wait) =>
      `注文を、短い間に、たくさん出しています。${wait}ほど待ってから、もう一度お試しください`,
  );

  resolveSource();

  // Turnstile のトークンは 1 回しか使えないので、断られる注文（受付停止・上限）では、先に使わせない。
  // ここは先回りの確認で、最終的な判定は、注文を作るトランザクションの中（db）が行う
  const setting = getSetting(deps.db.orm);
  if (setting.acceptance !== "open" || setting.businessDate === null) {
    throw new ApiException(
      "NOT_ACCEPTING",
      setting.busyMessage ?? "現在、注文を受け付けていません",
      {
        acceptance: setting.acceptance,
        busyMessage: setting.busyMessage,
      },
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
    const result = await deps.turnstile.verify(request.turnstileToken, ip);
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

  const source = resolveSource();
  const { order } = createOrder(deps.db, {
    imagePath: source.imagePath,
    editorData: source.editorData,
    quantity: request.quantity,
    kiraQuantity: request.kiraQuantity,
    magnetQuantity: request.magnetQuantity,
    anonToken: token,
    ...(source.sourceArchiveEntryId ? { sourceArchiveEntryId: source.sourceArchiveEntryId } : {}),
  });
  return { orderId: order.id };
}
