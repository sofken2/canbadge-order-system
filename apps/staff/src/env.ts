import { siteUrlFrom } from "./monitor-logic";

/**
 * 来場者向けサイトの URL。呼び出しモニターの固定 QR になる。
 * 値は、ビルド時に決まる（VITE_ で始まる名前だけが、画面に渡る）
 */
export const siteUrl: string | undefined = siteUrlFrom(import.meta.env.VITE_SITE_URL);
