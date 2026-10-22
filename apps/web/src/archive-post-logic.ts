import type { ArchiveStatus } from "@canbadge/shared";

// アーカイブへの投稿・取り下げ（W06）。画面の計算の部分。
// 同意のチェックがないと投稿できないことは、画面（ここ）と api（契約のスキーマ・db）の両方で保証する。

export const DISPLAY_NAME_MAX = 20;

/**
 * 同意のチェックの文。入力の画面（ArchivePostFields）と、足りないときの案内（postFormProblem）で、同じ文を使う。
 * 権利の同意は、ふつうの注文の確認（OrderPage）と同じ言い方にそろえる
 */
export const SELF_MADE_LABEL = "自作の画像、または使ってよい画像です";
export const ALLOW_OTHERS_LABEL = "他のお客さんがこの作品を注文してもよいです";

export type PostFormState = {
  displayName: string;
  /** 自作であること（または、使ってよい画像であること） */
  selfMade: boolean;
  /** 他の来場者が、この作品を注文してよいこと */
  allowOthersToOrder: boolean;
};

export const emptyPostForm: PostFormState = {
  displayName: "",
  selfMade: false,
  allowOthersToOrder: false,
};

/**
 * 投稿できない理由。投稿してよければ undefined。
 * 「何が足りないか → どうするか」の順で書く（ボタンを押せない理由が、わかるように）
 */
export function postFormProblem(form: PostFormState): string | undefined {
  const name = form.displayName.trim();
  if (name === "") return "表示名を入れてください（ニックネームで、かまいません）";
  if (name.length > DISPLAY_NAME_MAX) return `表示名は、${DISPLAY_NAME_MAX} 文字までです`;
  if (!form.selfMade) return `「${SELF_MADE_LABEL}」に、チェックを入れてください`;
  if (!form.allowOthersToOrder) {
    return `「${ALLOW_OTHERS_LABEL}」に、チェックを入れてください`;
  }
  return undefined;
}

export const canPost = (form: PostFormState): boolean => postFormProblem(form) === undefined;

/** api に渡す形。投稿できない状態で呼ぶと、例外（画面は、ボタンを押せなくしているので、起きない） */
export function toPostRequest(form: PostFormState): {
  displayName: string;
  consent: { selfMade: true; allowOthersToOrder: true };
} {
  const problem = postFormProblem(form);
  if (problem) throw new Error(problem);
  return {
    displayName: form.displayName.trim(),
    consent: { selfMade: true, allowOthersToOrder: true },
  };
}

/** 自分の投稿の、状態の名前と、来場者に伝えたいこと */
export const myEntryStatus: Record<ArchiveStatus, { label: string; note: string }> = {
  pending_review: {
    label: "審査待ち",
    note: "スタッフが、公開してよいかを、確認しています。確認が済むと、みんなの作品に出ます。",
  },
  public: {
    label: "公開中",
    note: "みんなの作品に出ています。他のお客さんが、同じバッジを注文できます。",
  },
  rejected: {
    label: "公開されませんでした",
    note: "スタッフの確認で、公開しないことになりました。",
  },
  hidden: {
    label: "非公開",
    note: "取り下げたか、スタッフが非公開にしました。みんなの作品には、出ていません。",
  },
};

/** 取り下げられるのは、公開中の作品だけ（表にない遷移は、api が 409 で断る） */
export const canWithdraw = (status: ArchiveStatus): boolean => status === "public";

/** 取り下げる前の確認の文。何が起きるかを、具体的に書く */
export function withdrawConfirmMessage(displayName: string): string {
  return `「${displayName}」の作品を、取り下げます。みんなの作品から消えて、他のお客さんは、この作品を注文できなくなります。この作品を見て、まだ支払っていない人の注文は、止まります。`;
}

/**
 * 注文のあとに公開を選んだとき（注文状況の画面）の案内。その画面には投稿の状態を出さないので、
 * 状態は「自分の投稿」で確かめてもらう（呼ぶ側が、そこへの入口を添える）
 */
export const postedMessage =
  "投稿しました。スタッフが確認してから公開されます。公開されたかどうかは、「自分の投稿」で確かめられます。";
