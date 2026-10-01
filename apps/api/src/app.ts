import { Hono } from "hono";

export const app = new Hono();

// 画面と Caddy が疎通を確かめるための最小の口。業務のエンドポイントは、
// packages/shared の契約（T04）ができてから T07 で作る
app.get("/api/health", (c) => c.json({ status: "ok" }));
