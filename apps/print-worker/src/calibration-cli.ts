import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { badgeSpec } from "@canbadge/badge-spec";
import { resolveDataDir } from "@canbadge/db";
import { renderCalibrationPdf } from "./calibration-pdf";
import { createDriver } from "./driver";

// 較正用ページを、データ置き場の print-out/ に書き出す（実機で印刷して、定規で実測する）。
//   bun run calibration                    → calibration.pdf（補正なし。いちばん最初の、測定用）
//   bun run calibration --applied          → calibration-applied.pdf（今の補正を掛けたもの。値を入れたあとの、確認用）
//   bun run calibration --print            → 書き出したあと、PRINT_DRIVER のプリンターで、**実際に印刷する**（用紙が 1 枚出る）
// 印刷するときは、必ず「実際のサイズ（100%）」にする。「用紙に合わせる」は切る（sumatra ドライバーは、拡大縮小しない設定で送る）。

/** リポジトリの直下の .env.example と .env から、印刷の設定だけを読む（api・print-worker と同じ順で、.env が優先） */
function readPrintEnv(): Record<string, string | undefined> {
  const root = resolve(import.meta.dir, "..", "..", "..");
  const env: Record<string, string | undefined> = { ...process.env };
  for (const file of [".env.example", ".env"]) {
    const path = join(root, file);
    if (!existsSync(path)) continue;
    for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
      const match = /^\s*(PRINT_DRIVER|PRINTER_NAME|SUMATRA_PATH)\s*=\s*(.*?)\s*$/.exec(line);
      if (match?.[1] && match[2] !== undefined && process.env[match[1]] === undefined) {
        env[match[1]] = match[2].replace(/^["']|["']$/g, "");
      }
    }
  }
  return env;
}

const applied = process.argv.includes("--applied");
const shouldPrint = process.argv.includes("--print");
const dataDir = resolveDataDir();
const outDir = join(dataDir, "print-out");
mkdirSync(outDir, { recursive: true });
const path = join(outDir, applied ? "calibration-applied.pdf" : "calibration.pdf");

await Bun.write(path, await renderCalibrationPdf(badgeSpec, { applyCalibration: applied }));
console.log(`較正用ページを書き出しました: ${path}`);

if (shouldPrint) {
  const driver = createDriver(readPrintEnv(), { devOutDir: outDir });
  for (const problem of (await driver.preflight?.()) ?? []) console.log(`注意：${problem}`);
  console.log(`${driver.name} ドライバーで印刷します…`);
  await driver.print({ sheetId: "calibration", pdfPath: path });
  console.log(
    "印刷のジョブを送りました。出てきた用紙を、定規で測ってください（使い方は、ページの下に書いてあります）。",
  );
} else {
  console.log(
    "印刷は「実際のサイズ（100%）」で（用紙に合わせる・縮小は切る）。使い方は、ページの下に書いてあります。",
  );
}
