// 注文のあとに出す「みんなの作品として公開しますか」の材料。注文画面が、注文の確定のときに残し、
// 注文状況の画面が読む。投稿には、注文に使った画像の ID とデザインの中身が要るが、注文状況の api は
// それを返さないので、同じタブの中（sessionStorage）で、注文 ID ごとに渡す。
// sessionStorage が使えなくても（プライベートモードなど）、画面は動く（公開の案内が、出ないだけ）。

import { type EditorData, editorDataSchema } from "@canbadge/shared";
import { sessionStore } from "./browser-storage";

export type PublishOffer = { imageId: string; editorData: EditorData };

const keyFor = (orderId: string) => `canbadge-publish-offer:${orderId}`;

export function savePublishOffer(
  orderId: string,
  offer: PublishOffer,
  storage: Pick<Storage, "setItem"> = sessionStore(),
) {
  try {
    storage.setItem(keyFor(orderId), JSON.stringify(offer));
  } catch {
    // 保存できなくても、注文はできている（公開の案内が、出ないだけ）
  }
}

/** この注文の、公開の材料。なければ・形が違えば undefined（読むだけで、消さない。再読み込みでも出す） */
export function readPublishOffer(
  orderId: string,
  storage: Pick<Storage, "getItem"> = sessionStore(),
): PublishOffer | undefined {
  try {
    const raw = storage.getItem(keyFor(orderId));
    if (!raw) return undefined;
    const parsed = JSON.parse(raw) as { imageId?: unknown; editorData?: unknown };
    const editorData = editorDataSchema.safeParse(parsed.editorData);
    if (typeof parsed.imageId === "string" && parsed.imageId !== "" && editorData.success) {
      return { imageId: parsed.imageId, editorData: editorData.data };
    }
  } catch {
    // 読めなければ、出さない
  }
  return undefined;
}

/** 公開した・公開しないと決めたら、消す（もう案内を出さない） */
export function clearPublishOffer(
  orderId: string,
  storage: Pick<Storage, "removeItem"> = sessionStore(),
) {
  try {
    storage.removeItem(keyFor(orderId));
  } catch {
    // 消せなくても、困らない（タブを閉じれば消える）
  }
}
