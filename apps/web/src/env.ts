/**
 * Turnstile のサイトキー。設定があれば、注文の確認で Turnstile を出し、そのトークンを注文に付ける。
 * なければ（開発）、Turnstile は出さず、決まった文字列を付ける（api は、TURNSTILE_SECRET_KEY が未設定のときだけ、これを受け付ける。A06）
 */
export const turnstileSiteKey: string | undefined =
  import.meta.env.TURNSTILE_SITE_KEY?.trim() || undefined;

/**
 * Discord のアイコンの取り込み（W08）のボタンを出すか。api 側の DISCORD_* の設定がそろっているときだけ、1 にする
 * （設定がないのに出すと、押しても「使えません」になる）。値は秘密ではない
 */
export const discordEnabled: boolean = import.meta.env.VITE_DISCORD_ENABLED === "1";

/** 開発（Turnstile のキーなし）のとき、トークンの代わりに送る文字列。api は、TURNSTILE_SECRET_KEY が未設定のときだけ、これを受け付ける（A06） */
export const DEV_TURNSTILE_TOKEN = "dev";
