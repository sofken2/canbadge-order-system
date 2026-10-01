import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// 開発中も本番（Caddy）と同じく、画面は常に同じオリジンの /api を呼ぶ。
// そのため /api を api のポートへ転送し、CORS の設定を不要にする
export default defineConfig({
  plugins: [react()],
  server: {
    port: Number(process.env.STAFF_PORT ?? 3001),
    strictPort: true,
    proxy: { "/api": `http://localhost:${process.env.API_PORT ?? 3002}` },
  },
});
