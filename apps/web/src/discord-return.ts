import { idSchema } from "@canbadge/shared";

// Discord のアイコンの取り込み（W08）からの戻りを、読む。api は、注文画面（/）へ、次のどちらかを付けて戻す：
//   ?imageId=<画像 ID>        取り込めた。エディタの最初の写真にする
//   ?discordError=<理由>      取り込めなかった。理由を伝えて、手元の画像を選べるようにする

export type DiscordReturn = { imageId: string } | { error: string };

/** URL の検索部分（`?...`）から、戻りを読む。Discord の戻りでなければ undefined。imageId は、形が合うものだけを通す */
export function readDiscordReturn(search: string): DiscordReturn | undefined {
  const params = new URLSearchParams(search);
  const error = params.get("discordError");
  if (error) return { error };
  const imageId = idSchema.safeParse(params.get("imageId"));
  return imageId.success ? { imageId: imageId.data } : undefined;
}

/**
 * api は、注文画面を `/` と決めて戻す。`/` ははじめの画面になったので、戻りのアドレスなら、注文画面（/order）に移す。
 * 画面を描く前に呼ぶ（api の戻り先を変えずに済ませるため）
 */
export function moveDiscordReturnToOrder(
  location: Pick<Location, "pathname" | "search">,
  history: Pick<History, "replaceState">,
): void {
  if (location.pathname === "/" && readDiscordReturn(location.search)) {
    history.replaceState(null, "", `/order${location.search}`);
  }
}

// 「何が起きたか → どうするか」の順で書く。Discord の仕組みの細部（state・トークン）は、見せない
const messages: Record<string, string> = {
  denied: "Discord での許可が、キャンセルされました。もう一度試すか、手元の画像を選んでください。",
  state:
    "Discord からの戻りを確認できませんでした（時間がたちすぎた可能性があります）。もう一度、ボタンから試してください。",
  no_avatar:
    "Discord のアイコンが、設定されていません。Discord でアイコンを設定するか、手元の画像を選んでください。",
  image: "Discord のアイコンを、画像として読み込めませんでした。手元の画像を選んでください。",
  rate: "短い間に、何度も試しています。少し待ってから、もう一度お試しください。",
  unavailable:
    "いま、Discord から取り込めません。手元の画像を選ぶか、あとでもう一度お試しください。",
};

/** 知らない理由でも、画面を壊さず、使えないことと次の手を伝える */
export function discordErrorMessage(code: string): string {
  return messages[code] ?? messages.unavailable ?? "";
}
