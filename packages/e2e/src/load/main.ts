import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startStack } from "../processes";
import { HELP, parseArgs } from "./config";
import { formatReport } from "./report";
import { runLoad } from "./run";

// 負荷テストの入口（Q04）。`bun run load`（packages/e2e で）。
// 既定では、一時的な DB で、api と print-worker を起動して流す（本番のデータには、触れない）。

if (process.argv.includes("--help") || process.argv.includes("-h")) {
  console.log(HELP);
  process.exit(0);
}

let config: ReturnType<typeof parseArgs>;
try {
  config = parseArgs(process.argv.slice(2));
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  console.error("\n--help で、使い方を見られます");
  process.exit(2);
}

const progress = (message: string) => console.log(message);
let exitCode = 0;
let stack: Awaited<ReturnType<typeof startStack>> | undefined;
let dataDir: string | undefined;

try {
  let baseUrl = config.target;
  if (!baseUrl) {
    dataDir = mkdtempSync(join(tmpdir(), "canbadge-load-"));
    // 時間を圧縮するので、サーバー側の「待ち」（SSE の確認間隔・印刷キューの巡回・印刷を待つ時間）も、同じ倍率で縮める
    const scaledMs = (ms: number, floor: number) =>
      String(Math.max(floor, Math.round(ms / config.speed)));
    stack = await startStack(dataDir, {
      SSE_POLL_MS: scaledMs(2000, 50),
      PRINT_POLL_MS: scaledMs(2000, 100),
      PRINT_WAIT_OVERRIDE_SECONDS: String(
        Math.max(1, Math.round(config.printMaxWaitSeconds / config.speed)),
      ),
    });
    baseUrl = stack.baseUrl;
    progress(`一時的な api と print-worker を起動しました（${baseUrl}）`);
  } else {
    progress(
      `動いている api に流します（${baseUrl}）。サーバー側の待ち（SSE・印刷）は、そのままです`,
    );
  }

  progress(
    `流します：来場者 ${config.visitors} 人・${config.arrivalMinutes} 分・時間の圧縮 ${config.speed} 倍（実際は、約 ${Math.round(((config.arrivalMinutes + 20) * 60) / config.speed)} 秒）`,
  );
  const report = await runLoad(config, { baseUrl, progress });
  console.log(`\n${formatReport(report)}`);

  if (config.out) {
    await Bun.write(config.out, JSON.stringify(report, null, 2));
    console.log(`\n結果を書き出しました: ${config.out}`);
  }
  if (report.invariants.some((i) => !i.ok) || report.counts.failed > 0) {
    console.error(
      "\n整合性の確認が崩れた、または、作業が失敗しました。上の [整合性の確認] を見てください",
    );
    if (stack) console.error(`--- api の出力（末尾）---\n${stack.api.output().slice(-1500)}`);
    exitCode = 1;
  }
} catch (error) {
  console.error(error instanceof Error ? error.stack : String(error));
  if (stack)
    console.error(
      `--- api ---\n${stack.api.output().slice(-1500)}\n--- print-worker ---\n${stack.printWorker.output().slice(-1500)}`,
    );
  exitCode = 1;
} finally {
  await stack?.stop();
  if (dataDir) {
    for (let attempt = 0; attempt < 10; attempt++) {
      try {
        rmSync(dataDir, { recursive: true, force: true });
        break;
      } catch {
        Bun.gc(true);
        await Bun.sleep(100);
      }
    }
  }
}
process.exit(exitCode);
