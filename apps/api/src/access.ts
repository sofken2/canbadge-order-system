import {
  createLocalJWKSet,
  createRemoteJWKSet,
  type JSONWebKeySet,
  type JWTPayload,
  type JWTVerifyGetKey,
  jwtVerify,
} from "jose";

// Cloudflare Access が発行する JWT（Cf-Access-Jwt-Assertion）の検証（A05）。
// 署名・発行者・対象（aud）・有効期限を、jose で確かめる。ヘッダーがあるだけでは通さない。

export type AccessConfig = {
  /** 例: sofken2.cloudflareaccess.com（チーム名だけ「sofken2」でも受け付ける） */
  teamDomain: string;
  /** Application の Audience (AUD) tag */
  audience: string;
};

export type AccessIdentity = { email: string | undefined };

export type AccessVerifier = {
  /** 検証に通れば、スタッフの情報を返す。通らなければ、理由つきで失敗を返す（理由は、ログ用） */
  verify: (
    token: string | undefined,
  ) => Promise<{ ok: true; identity: AccessIdentity } | { ok: false; reason: string }>;
};

/** teamDomain を、発行者（iss）の形（https://<team>.cloudflareaccess.com）にそろえる */
export function normalizeTeamDomain(raw: string): string {
  const trimmed = raw
    .trim()
    .replace(/^https?:\/\//, "")
    .replace(/\/+$/, "");
  return trimmed.includes(".") ? trimmed : `${trimmed}.cloudflareaccess.com`;
}

/** 鍵の取得元を差し込める（本番は Cloudflare から取得して、キャッシュする。テストは手元の鍵） */
export function createAccessVerifier(
  config: AccessConfig,
  keys?: { jwks: JWTVerifyGetKey },
): AccessVerifier {
  const domain = normalizeTeamDomain(config.teamDomain);
  const issuer = `https://${domain}`;
  const jwks =
    keys?.jwks ??
    createRemoteJWKSet(new URL(`${issuer}/cdn-cgi/access/certs`), { timeoutDuration: 5000 });

  return {
    async verify(token) {
      if (!token) return { ok: false, reason: "Cf-Access-Jwt-Assertion がありません" };
      try {
        const { payload } = await jwtVerify(token, jwks, {
          issuer,
          audience: config.audience,
          // Access は RS256 で署名する。alg を決め打ちにして、none や HS256 への差し替えを防ぐ
          algorithms: ["RS256"],
        });
        return { ok: true, identity: identityOf(payload) };
      } catch (cause) {
        return { ok: false, reason: cause instanceof Error ? cause.message : String(cause) };
      }
    },
  };
}

function identityOf(payload: JWTPayload): AccessIdentity {
  return { email: typeof payload.email === "string" ? payload.email : undefined };
}

/** テスト用：手元の鍵の一覧から、検証器の鍵の取得元を作る */
export function localKeys(jwks: JSONWebKeySet): { jwks: JWTVerifyGetKey } {
  return { jwks: createLocalJWKSet(jwks) };
}

/** 環境変数から、設定を読む。どちらかが欠けていたら undefined（Access は未設定） */
export function accessConfigFromEnv(
  env: Record<string, string | undefined>,
): AccessConfig | undefined {
  const teamDomain = env.CF_ACCESS_TEAM_DOMAIN?.trim();
  const audience = env.CF_ACCESS_AUD?.trim();
  return teamDomain && audience ? { teamDomain, audience } : undefined;
}
