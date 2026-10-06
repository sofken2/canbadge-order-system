/// <reference types="vite/client" />

// 画面（ブラウザ）に渡す環境変数。vite.config.ts の envPrefix に合う名前だけが、ビルドに埋め込まれる。
interface ImportMetaEnv {
  /** 来場者向けサイトの URL。呼び出しモニターの固定 QR になる（未設定なら、QR は出さず、スタッフに知らせる） */
  readonly VITE_SITE_URL?: string;
}
