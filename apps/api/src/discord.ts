// Discord のアイコンの取り込み（W08）。OAuth2 の権限は identify のみ。
// Discord のユーザー ID・アクセストークンは、保存もログ出力もしない。アイコンを取得したら、すぐ捨てる（トークンは失効させる）。

/** 画面（エディタ）に戻すときの、失敗の種類。`/?discordError=<これ>` で渡す */
export type DiscordFailure =
  | "denied" // 来場者が、許可を拒否した
  | "state" // 戻り先の確認（state）が合わない・期限切れ
  | "no_avatar" // アイコンが設定されていない
  | "image" // 取得した画像が、使えない（形式・容量）
  | "rate" // 短い間に、何度も試した
  | "unavailable"; // Discord に届かない・設定がない・ほか

export class DiscordError extends Error {
  constructor(
    readonly reason: DiscordFailure,
    detail: string,
  ) {
    super(detail);
  }
}

export type DiscordConfig = { clientId: string; clientSecret: string; redirectUri: string };

/** 3 つとも設定されていれば、設定を返す。1 つでも欠けていれば undefined（取り込みは使えない） */
export function discordConfigFromEnv(env: Record<string, string | undefined>) {
  const clientId = env.DISCORD_CLIENT_ID?.trim();
  const clientSecret = env.DISCORD_CLIENT_SECRET?.trim();
  const redirectUri = env.DISCORD_REDIRECT_URI?.trim();
  if (!clientId || !clientSecret || !redirectUri) return undefined;
  return { clientId, clientSecret, redirectUri } satisfies DiscordConfig;
}

export type DiscordClient = {
  /** Discord の許可画面の URL（state は、Cookie と照合するために、呼び出し側が作る） */
  authorizeUrl: (state: string) => string;
  /** 許可の code から、本人のアイコン（PNG・静止画）のバイト列を取る。使い終わったトークンは、失効させる */
  fetchAvatar: (code: string) => Promise<Uint8Array>;
};

const DISCORD_API = "https://discord.com/api";
const DISCORD_CDN = "https://cdn.discordapp.com";
const USER_AGENT = "DiscordBot (canbadge-order-system, 1.0)";

// Discord の応答から URL を組み立てるので、想定の形だけを通す（パスを書き換えられないように）
const USER_ID = /^[0-9]{1,25}$/;
const AVATAR_HASH = /^(a_)?[0-9a-f]{1,64}$/;

export function createDiscordClient(
  config: DiscordConfig,
  options: { fetch?: typeof fetch; timeoutMs?: number; maxAvatarBytes: number },
): DiscordClient {
  const doFetch = options.fetch ?? fetch;
  const timeoutMs = options.timeoutMs ?? 8000;

  async function request(url: string, init: RequestInit): Promise<Response> {
    try {
      return await doFetch(url, {
        ...init,
        headers: { "user-agent": USER_AGENT, ...(init.headers as Record<string, string>) },
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch {
      throw new DiscordError("unavailable", "Discord に届きませんでした");
    }
  }

  /** code をトークンに換える。トークンは、この関数の呼び出しの間だけ使う */
  async function exchange(code: string): Promise<string> {
    const response = await request(`${DISCORD_API}/oauth2/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: config.clientId,
        client_secret: config.clientSecret,
        grant_type: "authorization_code",
        code,
        redirect_uri: config.redirectUri,
      }),
    });
    if (!response.ok) {
      // code の使い回し・期限切れは、400 invalid_grant。来場者には、やり直してもらう
      throw new DiscordError(
        response.status === 400 ? "state" : "unavailable",
        `トークンの交換に失敗しました（${response.status}）`,
      );
    }
    const body = (await response.json().catch(() => undefined)) as
      | { access_token?: unknown }
      | undefined;
    if (typeof body?.access_token !== "string") {
      throw new DiscordError("unavailable", "トークンの交換の応答が、想定と違います");
    }
    return body.access_token;
  }

  /** 使い終わったトークンを失効させる（失敗しても、取り込みは続ける。保存していないので、残るのは Discord 側だけ） */
  async function revoke(token: string): Promise<void> {
    await request(`${DISCORD_API}/oauth2/token/revoke`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: config.clientId,
        client_secret: config.clientSecret,
        token,
        token_type_hint: "access_token",
      }),
    }).catch(() => undefined);
  }

  return {
    authorizeUrl: (state) => {
      const query = new URLSearchParams({
        client_id: config.clientId,
        response_type: "code",
        redirect_uri: config.redirectUri,
        scope: "identify",
        state,
      });
      return `${DISCORD_API}/oauth2/authorize?${query}`;
    },

    fetchAvatar: async (code) => {
      const token = await exchange(code);
      try {
        const me = await request(`${DISCORD_API}/users/@me`, {
          headers: { authorization: `Bearer ${token}` },
        });
        if (!me.ok)
          throw new DiscordError("unavailable", `ユーザー情報の取得に失敗（${me.status}）`);
        const user = (await me.json().catch(() => undefined)) as
          | { id?: unknown; avatar?: unknown }
          | undefined;
        if (user?.avatar === null) throw new DiscordError("no_avatar", "アイコンが未設定です");
        if (
          typeof user?.id !== "string" ||
          typeof user.avatar !== "string" ||
          !USER_ID.test(user.id) ||
          !AVATAR_HASH.test(user.avatar)
        ) {
          throw new DiscordError("unavailable", "ユーザー情報の形が、想定と違います");
        }

        // 動くアイコン（a_ 付き）も、.png なら静止画で返る
        const avatar = await request(
          `${DISCORD_CDN}/avatars/${user.id}/${user.avatar}.png?size=1024`,
          {},
        );
        if (!avatar.ok)
          throw new DiscordError("unavailable", `アイコンの取得に失敗（${avatar.status}）`);
        const declared = Number(avatar.headers.get("content-length") ?? 0);
        if (declared > options.maxAvatarBytes) {
          throw new DiscordError("image", "アイコンの容量が、上限を超えています");
        }
        const bytes = new Uint8Array(await avatar.arrayBuffer());
        if (bytes.length > options.maxAvatarBytes) {
          throw new DiscordError("image", "アイコンの容量が、上限を超えています");
        }
        return bytes;
      } finally {
        await revoke(token);
      }
    },
  };
}
