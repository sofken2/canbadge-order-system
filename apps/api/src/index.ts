import { app } from "./app";

const port = Number(process.env.API_PORT ?? 3002);
console.log(`api: http://localhost:${port}`);

// default export にすると `bun --watch` の再起動でポートを掴み直してくれる
export default { port, fetch: app.fetch };
