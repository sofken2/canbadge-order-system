import { join } from "node:path";
import { databasePath, openDatabase, resolveDataDir } from "@canbadge/db";
import { createDriver } from "./driver";
import { startQueueLoop } from "./queue";

const dataDir = resolveDataDir();
// api と同じ DB を使う。DB がなければ、空の DB を作る
const db = openDatabase({ path: databasePath(dataDir) });

const driver = createDriver(process.env, { devOutDir: join(dataDir, "print-out") });
const waitOverride = process.env.PRINT_WAIT_OVERRIDE_SECONDS;
const intervalMs = Number(process.env.PRINT_POLL_MS ?? 2000);

const loop = startQueueLoop(
  db,
  {
    dataDir,
    driver,
    ...(waitOverride ? { waitOverrideSeconds: Number(waitOverride) } : {}),
    log: (message) => console.log(`print-worker: ${message}`),
  },
  intervalMs,
);

console.log(
  `print-worker: 起動しました（ドライバー ${driver.name}、${intervalMs}ms ごとに印刷キューを確認、データ置き場 ${dataDir}）`,
);

// 止めるときは、DB を閉じてから終わる
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    loop.stop();
    db.close();
    process.exit(0);
  });
}
