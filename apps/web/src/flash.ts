// 画面を移ったあとに、1 回だけ出す、お知らせ。注文の確定のあと、注文状況の画面で、
// 「作品の投稿ができなかった」ことを伝えるのに使う（注文は、できているので、止めない）。
// sessionStorage が使えなくても（プライベートモードなど）、画面は動く。

export type Flash = { tone: "info" | "error"; text: string };

const KEY = "canbadge-flash";

export function setFlash(flash: Flash, storage: Pick<Storage, "setItem"> = window.sessionStorage) {
  try {
    storage.setItem(KEY, JSON.stringify(flash));
  } catch {
    // 保存できなくても、画面は動く（お知らせが、出ないだけ）
  }
}

/** 保存してあるお知らせを、取り出して、消す。なければ undefined */
export function takeFlash(
  storage: Pick<Storage, "getItem" | "removeItem"> = window.sessionStorage,
): Flash | undefined {
  try {
    const raw = storage.getItem(KEY);
    if (!raw) return undefined;
    storage.removeItem(KEY);
    const parsed = JSON.parse(raw) as Partial<Flash>;
    if ((parsed.tone === "info" || parsed.tone === "error") && typeof parsed.text === "string") {
      return { tone: parsed.tone, text: parsed.text };
    }
  } catch {
    // 読めなければ、出さない
  }
  return undefined;
}
