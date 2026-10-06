import { describe, expect, test } from "bun:test";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import {
  accessConfigFromEnv,
  createAccessVerifier,
  localKeys,
  normalizeTeamDomain,
} from "./access";

const TEAM = "sofken2.cloudflareaccess.com";
const AUD = "a1b2c3d4e5f6";

/** Cloudflare Access と同じ形（RS256・kid 付き）の鍵と、署名つきのトークンを作る道具 */
async function setup() {
  const trusted = await generateKeyPair("RS256");
  const publicJwk = {
    ...(await exportJWK(trusted.publicKey)),
    kid: "trusted",
    alg: "RS256",
    use: "sig",
  };
  const verifier = createAccessVerifier(
    { teamDomain: TEAM, audience: AUD },
    localKeys({ keys: [publicJwk] }),
  );

  const sign = (
    claims: Record<string, unknown> = {},
    options: {
      key?: CryptoKey;
      kid?: string;
      issuer?: string;
      audience?: string | string[];
      expiresIn?: string | number;
      notBefore?: string | number;
    } = {},
  ) => {
    let jwt = new SignJWT({ email: "staff@example.com", ...claims })
      .setProtectedHeader({ alg: "RS256", kid: options.kid ?? "trusted" })
      .setIssuer(options.issuer ?? `https://${TEAM}`)
      .setAudience(options.audience ?? AUD)
      .setIssuedAt()
      .setExpirationTime(options.expiresIn ?? "1h");
    if (options.notBefore !== undefined) jwt = jwt.setNotBefore(options.notBefore);
    return jwt.sign(options.key ?? trusted.privateKey);
  };

  return { verifier, sign, trusted };
}

describe("Access の JWT の検証", () => {
  test("正しい署名・発行者・対象・期限なら通り、メールアドレスを返す", async () => {
    const { verifier, sign } = await setup();
    const result = await verifier.verify(await sign());
    expect(result).toEqual({ ok: true, identity: { email: "staff@example.com" } });
  });

  test("aud が配列でも、自分の AUD が含まれていれば通る", async () => {
    const { verifier, sign } = await setup();
    const result = await verifier.verify(await sign({}, { audience: ["other", AUD] }));
    expect(result.ok).toBe(true);
  });

  test("ヘッダーがない（トークンが空・未定義）なら、断る", async () => {
    const { verifier } = await setup();
    expect((await verifier.verify(undefined)).ok).toBe(false);
    expect((await verifier.verify("")).ok).toBe(false);
  });

  test("署名が違う（ほかの鍵で作った）トークンは、断る。kid を、正しいものに偽っても同じ", async () => {
    const { verifier, sign } = await setup();
    const attacker = await generateKeyPair("RS256");
    const forged = await sign({}, { key: attacker.privateKey, kid: "trusted" });
    expect((await verifier.verify(forged)).ok).toBe(false);
    const unknownKid = await sign({}, { key: attacker.privateKey, kid: "attacker" });
    expect((await verifier.verify(unknownKid)).ok).toBe(false);
  });

  test("中身を書き換えたトークンは、断る", async () => {
    const { verifier, sign } = await setup();
    const token = await sign();
    const [header, , signature] = token.split(".");
    const payload = Buffer.from(
      JSON.stringify({
        email: "attacker@example.com",
        iss: `https://${TEAM}`,
        aud: AUD,
        exp: 9999999999,
      }),
    ).toString("base64url");
    expect((await verifier.verify(`${header}.${payload}.${signature}`)).ok).toBe(false);
  });

  test("対象（aud）が別の Application のトークンは、断る", async () => {
    const { verifier, sign } = await setup();
    const result = await verifier.verify(await sign({}, { audience: "someone-elses-app" }));
    expect(result.ok).toBe(false);
  });

  test("発行者（iss）が、別のチームのトークンは、断る", async () => {
    const { verifier, sign } = await setup();
    const result = await verifier.verify(
      await sign({}, { issuer: "https://other-team.cloudflareaccess.com" }),
    );
    expect(result.ok).toBe(false);
  });

  test("期限切れのトークンは、断る", async () => {
    const { verifier, sign } = await setup();
    const expired = await sign({}, { expiresIn: Math.floor(Date.now() / 1000) - 60 });
    expect((await verifier.verify(expired)).ok).toBe(false);
  });

  test("まだ有効になっていない（nbf が未来の）トークンは、断る", async () => {
    const { verifier, sign } = await setup();
    const early = await sign({}, { notBefore: Math.floor(Date.now() / 1000) + 3600 });
    expect((await verifier.verify(early)).ok).toBe(false);
  });

  test("署名なし（alg: none）や、別の方式（HS256）に差し替えたトークンは、断る", async () => {
    const { verifier } = await setup();
    const none = [
      Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url"),
      Buffer.from(
        JSON.stringify({ iss: `https://${TEAM}`, aud: AUD, exp: 9999999999, email: "a@b.c" }),
      ).toString("base64url"),
      "",
    ].join(".");
    expect((await verifier.verify(none)).ok).toBe(false);

    const hs256 = await new SignJWT({ email: "a@b.c" })
      .setProtectedHeader({ alg: "HS256", kid: "trusted" })
      .setIssuer(`https://${TEAM}`)
      .setAudience(AUD)
      .setExpirationTime("1h")
      .sign(new TextEncoder().encode("a-shared-secret-that-is-long-enough-1234567890"));
    expect((await verifier.verify(hs256)).ok).toBe(false);
  });

  test("JWT の形をしていない文字列は、断る（例外にしない）", async () => {
    const { verifier } = await setup();
    for (const junk of ["abc", "a.b.c", "Bearer xyz", "....", " "]) {
      expect((await verifier.verify(junk)).ok).toBe(false);
    }
  });
});

describe("設定", () => {
  test("チーム名は、ドメインの形にそろえる（http や末尾の / があっても）", () => {
    expect(normalizeTeamDomain("sofken2")).toBe("sofken2.cloudflareaccess.com");
    expect(normalizeTeamDomain(" https://sofken2.cloudflareaccess.com/ ")).toBe(
      "sofken2.cloudflareaccess.com",
    );
  });

  test("環境変数：2 つそろったときだけ設定になる", () => {
    expect(accessConfigFromEnv({ CF_ACCESS_TEAM_DOMAIN: "t", CF_ACCESS_AUD: "a" })).toEqual({
      teamDomain: "t",
      audience: "a",
    });
    expect(accessConfigFromEnv({ CF_ACCESS_TEAM_DOMAIN: "t", CF_ACCESS_AUD: "" })).toBeUndefined();
    expect(accessConfigFromEnv({ CF_ACCESS_TEAM_DOMAIN: " ", CF_ACCESS_AUD: "a" })).toBeUndefined();
    expect(accessConfigFromEnv({})).toBeUndefined();
  });
});
