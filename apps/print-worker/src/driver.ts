import { copyFileSync, mkdirSync } from "node:fs";
import { basename, join } from "node:path";
import { badgeSpec } from "@canbadge/badge-spec";
import { createSumatraDriver, paperSizeName, resolveSumatraPath } from "./driver-sumatra";

/** 印刷するもの 1 件。pdfPath は、PDF の絶対パス */
export type PrintJob = { sheetId: string; pdfPath: string };

/**
 * 印刷ドライバー。印刷の実行だけを受け持つ。ドライバーを差し替えられるようにして、
 * 開発・テスト（どの OS でも動く）と本番（Windows + プリンター）を、同じキューで動かす
 */
export type PrintDriver = {
  readonly name: string;
  print: (job: PrintJob) => Promise<void>;
  /** 起動時の確認。印刷できない原因（プリンターが見つからないなど）があれば、その説明を返す。なければ、空 */
  preflight?: () => Promise<string[]>;
};

/**
 * 開発用ドライバー。PDF を出力フォルダに複製するだけで、実際には印刷しない。
 * 出力先のフォルダを開けば、印刷されるはずだった PDF を確認できる
 */
export function createDevDriver(outDir: string): PrintDriver {
  return {
    name: "dev",
    print: async (job) => {
      mkdirSync(outDir, { recursive: true });
      copyFileSync(job.pdfPath, join(outDir, basename(job.pdfPath)));
    },
  };
}

/**
 * 環境変数から、使うドライバーを選ぶ。プリンター名などは、コードに書かず環境変数で渡す。
 * - PRINT_DRIVER=dev（既定）：PDF を `data/print-out/` に複製するだけ（どの OS でも動く）
 * - PRINT_DRIVER=sumatra：本番。Windows で、SumatraPDF を使い、PRINTER_NAME のプリンターへ、拡大縮小なしで送る。
 *   SUMATRA_PATH（省略すると、よく入る場所を探す）
 */
export function createDriver(
  env: Record<string, string | undefined>,
  options: { devOutDir: string },
): PrintDriver {
  const kind = env.PRINT_DRIVER ?? "dev";
  if (kind === "dev") return createDevDriver(options.devOutDir);
  if (kind === "sumatra") {
    if (process.platform !== "win32") {
      throw new Error("PRINT_DRIVER=sumatra は、Windows でだけ使えます");
    }
    const printerName = env.PRINTER_NAME?.trim();
    if (!printerName) {
      throw new Error(
        "PRINT_DRIVER=sumatra には、PRINTER_NAME（Windows のプリンター名）が要ります。bun run printers で、名前の一覧が見られます",
      );
    }
    return createSumatraDriver({
      sumatraPath: resolveSumatraPath(env),
      printerName,
      paper: paperSizeName(badgeSpec.paper.widthMm, badgeSpec.paper.heightMm),
    });
  }
  throw new Error(`PRINT_DRIVER=${kind} は使えません（dev か sumatra）`);
}
