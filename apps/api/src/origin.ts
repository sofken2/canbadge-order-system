// リクエストが、どの経路から来たかの判定（A05）。画面から切り離した、純粋な関数。

/**
 * - cloudflare：Cloudflare（トンネル）を通った。公開された経路
 * - local：処理 PC の中（localhost）から。Caddy 経由でも、api に直接でも
 * - lan：会場の LAN など、その PC の外から、Cloudflare を通らずに来た
 */
export type Origin = "cloudflare" | "local" | "lan";

/** 127.0.0.0/8・::1・::ffff:127.x.x.x */
export function isLoopback(address: string): boolean {
  const value = address.trim().toLowerCase();
  if (value === "::1") return true;
  const v4 = value.startsWith("::ffff:") ? value.slice("::ffff:".length) : value;
  return /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(v4);
}

/** X-Forwarded-For の、いちばん右。いちばん近いプロキシ（Caddy）が見た、実際の接続元 */
export function nearestForwardedAddress(header: string | undefined): string | undefined {
  const last = header?.split(",").at(-1)?.trim();
  return last ? last : undefined;
}

/**
 * 経路を判定する。
 * - Cloudflare は、通したリクエストに必ず cf-ray と cf-connecting-ip を付ける。外から、これらを消すことはできない。
 *   （LAN の人が、偽って付けることはできるが、その場合は、署名つきの JWT が必要になるので、より厳しくなるだけ）
 * - Caddy 経由のときは、api への接続は常に localhost になるので、Caddy が付ける X-Forwarded-For の
 *   いちばん右（実際の接続元）も見る。左側は、クライアントが付けられるので、信用しない
 * - remoteAddress がわからないとき（テストなど）は、localhost として扱う
 */
export function classifyOrigin(input: {
  headers: { get: (name: string) => string | null | undefined };
  remoteAddress: string | undefined;
}): Origin {
  const { headers, remoteAddress } = input;
  if (headers.get("cf-ray") || headers.get("cf-connecting-ip")) return "cloudflare";

  if (remoteAddress !== undefined && !isLoopback(remoteAddress)) return "lan";
  const forwarded = nearestForwardedAddress(headers.get("x-forwarded-for") ?? undefined);
  if (forwarded !== undefined && !isLoopback(forwarded)) return "lan";
  return "local";
}

/**
 * 来場者の IP（回数の制限の相手）。
 * - Cloudflare 経由：cf-connecting-ip（Cloudflare が付ける。外から偽れない）
 * - Caddy 経由：X-Forwarded-For のいちばん右（実際の接続元。左側は偽れるので見ない）
 * - 直接：接続元のアドレス
 * わからなければ undefined
 */
export function clientAddress(input: {
  headers: { get: (name: string) => string | null | undefined };
  remoteAddress: string | undefined;
}): string | undefined {
  const cf = input.headers.get("cf-connecting-ip")?.trim();
  if (cf) return cf;
  return (
    nearestForwardedAddress(input.headers.get("x-forwarded-for") ?? undefined) ??
    input.remoteAddress
  );
}
