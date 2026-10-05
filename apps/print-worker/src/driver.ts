import { copyFileSync, mkdirSync } from "node:fs";
import { basename, join } from "node:path";

/** 印刷するもの 1 件。pdfPath は、PDF の絶対パス */
export type PrintJob = { sheetId: string; pdfPath: string };

/**
 * 印刷ドライバー。印刷の実行だけを受け持つ。ドライバーを差し替えられるようにして、
 * 開発・テスト（どの OS でも動く）と本番（Windows + プリンター）を、同じキューで動かす
 */
export type PrintDriver = {
  readonly name: string;
  print: (job: PrintJob) => Promise<void>;
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
 * PRINT_DRIVER: dev（既定）。本番用（SumatraPDF）は P03 で足す
 */
export function createDriver(
  env: Record<string, string | undefined>,
  options: { devOutDir: string },
): PrintDriver {
  const kind = env.PRINT_DRIVER ?? "dev";
  if (kind === "dev") return createDevDriver(options.devOutDir);
  throw new Error(
    `PRINT_DRIVER=${kind} は使えません（dev のみ。本番用のドライバーは P03 で実装します）`,
  );
}
