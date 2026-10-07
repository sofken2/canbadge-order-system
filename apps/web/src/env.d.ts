/// <reference types="vite/client" />

// 画面（ブラウザ）に渡す環境変数。vite.config.ts の envPrefix に合う名前だけが、ビルドに埋め込まれる。
interface ImportMetaEnv {
  /** Turnstile のサイトキー（公開してよい）。未設定なら、開発用の動作（Turnstile なし） */
  readonly TURNSTILE_SITE_KEY?: string;
  /** 1 なら、Discord のアイコンの取り込みのボタンを出す（W08） */
  readonly VITE_DISCORD_ENABLED?: string;
}
