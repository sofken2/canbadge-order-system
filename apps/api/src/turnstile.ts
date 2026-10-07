// Cloudflare Turnstile のトークンの検証（A06）。画面（W02）が付けたトークンを、サーバーで必ず確かめる。
// 画面側の判定だけでは、API を直接呼ばれると回避される。

const SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
/** Cloudflare が受け付けるトークンの最大の長さ。それより長いものは、送らずに断る */
const MAX_TOKEN_LENGTH = 2048;
const TIMEOUT_MS = 5000;

export type TurnstileResult =
  | { ok: true }
  /** reason はログ用（画面には出さない）。transient は、Cloudflare に届かなかったなど、来場者のせいではない失敗 */
  | { ok: false; reason: string; transient: boolean };

export type TurnstileVerifier = {
  /** ip は、来場者の IP（任意。Cloudflare が、トークンと接続元の一致を確かめるのに使える） */
  verify: (token: string, ip?: string) => Promise<TurnstileResult>;
};

type SiteverifyResponse = { success?: unknown; "error-codes"?: unknown };

export function createTurnstileVerifier(options: {
  secret: string;
  /** テストで差し替える。既定は、グローバルの fetch */
  fetch?: typeof fetch;
}): TurnstileVerifier {
  const doFetch = options.fetch ?? fetch;
  return {
    async verify(token, ip) {
      // 空・長すぎるトークンは、Cloudflare に送らずに断る（無駄な通信と、入力の悪用を防ぐ）
      if (token.length === 0 || token.length > MAX_TOKEN_LENGTH) {
        return { ok: false, reason: "トークンの形が正しくありません", transient: false };
      }
      const body = new URLSearchParams({ secret: options.secret, response: token });
      if (ip) body.set("remoteip", ip);

      let json: SiteverifyResponse;
      try {
        const res = await doFetch(SITEVERIFY_URL, {
          method: "POST",
          body,
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
        if (!res.ok) return { ok: false, reason: `siteverify が ${res.status}`, transient: true };
        json = (await res.json()) as SiteverifyResponse;
      } catch (cause) {
        // 届かない・時間切れ・JSON でない。通してはいけない（開けっぱなしにしない）
        const reason = cause instanceof Error ? cause.message : String(cause);
        return { ok: false, reason: `siteverify に届きません（${reason}）`, transient: true };
      }

      if (json.success === true) return { ok: true };
      const codes = Array.isArray(json["error-codes"]) ? json["error-codes"].join(",") : "";
      // invalid-input-secret・missing-input-secret は、こちらの設定の間違い（来場者のせいではない）
      const ours = /input-secret/.test(codes);
      return { ok: false, reason: codes || "success が true ではありません", transient: ours };
    },
  };
}
