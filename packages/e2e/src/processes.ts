import { join } from "node:path";
import { findRepoRoot } from "@canbadge/db";

// 通し確認のために、api と print-worker を、本番と同じように別々のプロセスで起動する。
// 2 つのプロセスが同じ SQLite を使うこと（採番・操作ログ経由の SSE）まで確かめるため。

export type ManagedProcess = {
  name: string;
  /** これまでの標準出力と標準エラー（失敗したときの原因調べに使う） */
  output: () => string;
  stop: () => Promise<void>;
};

function start(name: string, script: string, env: Record<string, string>): ManagedProcess {
  const root = findRepoRoot();
  const child = Bun.spawn([process.execPath, "run", join(root, script)], {
    cwd: root,
    env: { ...process.env, ...env },
    stdout: "pipe",
    stderr: "pipe",
  });

  let text = "";
  const collect = async (stream: ReadableStream<Uint8Array>) => {
    const decoder = new TextDecoder();
    const reader = stream.getReader();
    for (;;) {
      const { value, done } = await reader.read();
      if (done) return;
      text += decoder.decode(value, { stream: true });
    }
  };
  void collect(child.stdout);
  void collect(child.stderr);

  return {
    name,
    output: () => text,
    stop: async () => {
      child.kill();
      await child.exited;
    },
  };
}

/** 空いているポートを 1 つ探す */
export function freePort(): number {
  const server = Bun.serve({ port: 0, fetch: () => new Response("") });
  const port = server.port;
  server.stop(true);
  if (port === undefined) throw new Error("空いているポートが見つかりません");
  return port;
}

export type Stack = {
  baseUrl: string;
  dataDir: string;
  api: ManagedProcess;
  printWorker: ManagedProcess;
  stop: () => Promise<void>;
};

/**
 * api と print-worker を起動する。待ち時間は短くする（SSE の確認・印刷キューの巡回を 0.2 秒ごと、
印刷は待たずに即座に）。DB は先に作らない（空の DB への同時起動も、確かめるため）
 */
export async function startStack(
  dataDir: string,
  extraEnv: Record<string, string> = {},
): Promise<Stack> {
  const port = freePort();
  const env = {
    DATA_DIR: dataDir,
    API_PORT: String(port),
    SSE_POLL_MS: "200",
    PRINT_POLL_MS: "200",
    PRINT_WAIT_OVERRIDE_SECONDS: "0",
    ...extraEnv,
  };
  const api = start("api", "apps/api/src/index.ts", env);
  const printWorker = start("print-worker", "apps/print-worker/src/index.ts", env);
  const baseUrl = `http://localhost:${port}`;

  // api が応答するまで待つ
  const deadline = Date.now() + 15_000;
  for (;;) {
    try {
      const response = await fetch(`${baseUrl}/api/health`);
      if (response.ok) break;
    } catch {
      // まだ起動していない
    }
    if (Date.now() > deadline) {
      await Promise.all([api.stop(), printWorker.stop()]);
      throw new Error(`api が起動しませんでした\n${api.output()}`);
    }
    await Bun.sleep(100);
  }

  return {
    baseUrl,
    dataDir,
    api,
    printWorker,
    stop: async () => {
      await Promise.all([api.stop(), printWorker.stop()]);
    },
  };
}
