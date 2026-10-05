import type { Context } from "hono";
import { getCookie, setCookie } from "hono/cookie";

/** 匿名トークンを入れる Cookie。来場者本人の注文を判定するのに使う（アカウント登録はしない） */
export const ANON_COOKIE = "anon_token";

export function readAnonToken(c: Context): string | undefined {
  return getCookie(c, ANON_COOKIE);
}

/** 匿名トークンを返す。なければ作って Cookie に入れる（画面側で作らせない） */
export function ensureAnonToken(c: Context): string {
  const existing = readAnonToken(c);
  if (existing && existing.length >= 16) return existing;

  const token = crypto.randomUUID().replaceAll("-", "");
  setCookie(c, ANON_COOKIE, token, {
    httpOnly: true,
    sameSite: "Lax",
    path: "/",
    // 学祭の間だけ使えればよい。端末を変えた人は、注文照会（番号 + 確認コード）で開く
    maxAge: 60 * 60 * 24 * 3,
    secure: c.req.header("x-forwarded-proto") === "https",
  });
  return token;
}
