/**
 * Turnstile のサイトキー。設定があれば、注文の確認で Turnstile を出し、そのトークンを注文に付ける。
 * なければ（開発）、Turnstile は出さず、決まった文字列を付ける（api は、TURNSTILE_SECRET_KEY が未設定のときだけ、これを受け付ける。A06）
 */
export const turnstileSiteKey: string | undefined =
  import.meta.env.TURNSTILE_SITE_KEY?.trim() || undefined;
