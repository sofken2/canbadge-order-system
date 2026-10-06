import { resolve } from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// 開発中も本番（Caddy）と同じく、画面は常に同じオリジンの /api を呼ぶ。
// そのため /api を api のポートへ転送し、CORS の設定を不要にする
export default defineConfig({
  plugins: [react()],
  // .env は、リポジトリの直下に 1 つだけ置く
  envDir: resolve(import.meta.dirname, "../.."),
  // ブラウザに渡してよいのは、この名前で始まるものだけ。
  // TURNSTILE_SITE_ で止めているのは、同じ .env にある TURNSTILE_SECRET_KEY（秘密）を、画面に埋め込まないため。
  // ここに、秘密の値の名前が当たる接頭辞を足さない
  envPrefix: ["VITE_", "TURNSTILE_SITE_"],
  server: {
    port: Number(process.env.WEB_PORT ?? 3000),
    strictPort: true,
    proxy: { "/api": `http://localhost:${process.env.API_PORT ?? 3002}` },
  },
});
