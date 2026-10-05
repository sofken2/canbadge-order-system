import { createApiClient } from "@canbadge/api-client";

/** 画面は、常に同じオリジンの /api を呼ぶ（開発では Vite が api へ転送し、本番では Caddy が振り分ける） */
export const api = createApiClient();
