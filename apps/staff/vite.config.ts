import { resolve } from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";

// 開発中も本番（Caddy）と同じく、画面は常に同じオリジンの /api を呼ぶ。
// そのため /api を api のポートへ転送し、CORS の設定を不要にする
export default defineConfig(({ command, mode }) => {
  const root = resolve(import.meta.dirname, "../..");
  // 開発では、固定 QR の URL が未設定でも、来場者向けの開発サーバーを指す（本番のビルドでは、未設定のまま、画面が知らせる）
  const siteUrl = loadEnv(mode, root, "VITE_").VITE_SITE_URL?.trim();
  const devSiteUrl =
    command === "serve" && !siteUrl
      ? `http://localhost:${process.env.WEB_PORT ?? 3000}`
      : undefined;

  return {
    plugins: [react()],
    // .env は、リポジトリの直下に 1 つだけ置く
    envDir: root,
    // ブラウザに渡してよいのは、VITE_ で始まるものだけ（.env の秘密の値を、画面に埋め込まないため）
    envPrefix: ["VITE_"],
    define: devSiteUrl ? { "import.meta.env.VITE_SITE_URL": JSON.stringify(devSiteUrl) } : {},
    server: {
      port: Number(process.env.STAFF_PORT ?? 3001),
      strictPort: true,
      proxy: { "/api": `http://localhost:${process.env.API_PORT ?? 3002}` },
    },
  };
});
