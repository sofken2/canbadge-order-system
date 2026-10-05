import { defineConfig } from "drizzle-kit";

// マイグレーションは `bun run db:generate` で生成する。生成済みのファイルは編集しない
export default defineConfig({
  dialect: "sqlite",
  schema: "./src/schema.ts",
  out: "./drizzle",
});
