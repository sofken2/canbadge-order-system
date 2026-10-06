/**
 * Turnstile のサイトキー。設定があれば、注文の確認で Turnstile を出し、そのトークンを注文に付ける。
 * なければ（開発）、Turnstile は出さず、決まった文字列を付ける（サーバー側の検証は A06）
 */
export const turnstileSiteKey: string | undefined =
  import.meta.env.TURNSTILE_SITE_KEY?.trim() || undefined;
