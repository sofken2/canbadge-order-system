import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { badgeSpec } from "@canbadge/badge-spec";
import { resolveDataDir } from "@canbadge/db";
import { renderCalibrationPdf } from "./calibration-pdf";

// 較正用ページを、データ置き場の print-out/ に書き出す（実機で印刷して、定規で実測する）。
//   bun run calibration            → calibration.pdf（補正なし。いちばん最初の、測定用）
//   bun run calibration --applied  → calibration-applied.pdf（今の補正を掛けたもの。値を入れたあとの、確認用）
// 印刷するときは、必ず「実際のサイズ（100%）」にする。「用紙に合わせる」は切る。

const applied = process.argv.includes("--applied");
const outDir = join(resolveDataDir(), "print-out");
mkdirSync(outDir, { recursive: true });
const path = join(outDir, applied ? "calibration-applied.pdf" : "calibration.pdf");

await Bun.write(path, await renderCalibrationPdf(badgeSpec, { applyCalibration: applied }));
console.log(`較正用ページを書き出しました: ${path}`);
console.log(
  "印刷は「実際のサイズ（100%）」で（用紙に合わせる・縮小は切る）。使い方は、ページの下に書いてあります。",
);
