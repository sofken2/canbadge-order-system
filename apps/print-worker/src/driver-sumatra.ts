import { existsSync } from "node:fs";
import { win32 } from "node:path";
import type { PrintDriver } from "./driver";

// 本番用の印刷ドライバー（P03）。Windows で、SumatraPDF のコマンドラインを使い、PDF を、拡大縮小なしで、
// 指定のプリンターに送る。外部コマンドは、引数を配列で渡す（シェルを通さない）。

/** 外部コマンドの実行結果 */
export type RunResult = { exitCode: number; stdout: string; stderr: string; timedOut: boolean };

/** 外部コマンドを実行する。テストでは、これを差し替える（実際には、何も起動しない） */
export type Runner = (command: string[], options: { timeoutMs: number }) => Promise<RunResult>;

/** Bun で、実際にコマンドを起動する。シェルは通さない。時間切れになったら、強制終了する */
export const bunRunner: Runner = async (command, { timeoutMs }) => {
  const child = Bun.spawn(command, { stdout: "pipe", stderr: "pipe", stdin: "ignore" });
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    child.kill();
  }, timeoutMs);
  try {
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    return { exitCode, stdout, stderr, timedOut };
  } finally {
    clearTimeout(timer);
  }
};

/** 印刷の送信にかける、最大の時間。これをこえたら、プリンターが応答していないと見て、失敗にする */
export const PRINT_TIMEOUT_MS = 60_000;

/** badge-spec の用紙の大きさ（mm）から、SumatraPDF の用紙の指定にする。知らない大きさは、指定しない（プリンターの既定） */
export function paperSizeName(widthMm: number, heightMm: number): string | undefined {
  const near = (a: number, b: number) => Math.abs(a - b) < 1;
  const sizes: [string, number, number][] = [
    ["A4", 210, 297],
    ["A3", 297, 420],
    ["A5", 148, 210],
    ["B5", 182, 257],
    ["letter", 215.9, 279.4],
  ];
  return sizes.find(([, w, h]) => near(widthMm, w) && near(heightMm, h))?.[0];
}

/**
 * SumatraPDF に渡す引数。
 * - `-print-to "<プリンター名>"`：指定のプリンターへ、確認の画面なしで送る
 * - `-print-settings`：**noscale**（拡大縮小しない。実寸で印刷するための、いちばん大事な指定）、color、用紙の大きさ
 * - `-silent`：エラーの画面（ダイアログ）を出さない（無人で動くため。失敗は、終了コードで知る）
 */
export function buildSumatraArgs(input: {
  sumatraPath: string;
  printerName: string;
  pdfPath: string;
  paper?: string | undefined;
}): string[] {
  const settings = ["noscale", "color", ...(input.paper ? [`paper=${input.paper}`] : [])];
  return [
    input.sumatraPath,
    "-print-to",
    input.printerName,
    "-print-settings",
    settings.join(","),
    "-silent",
    input.pdfPath,
  ];
}

/** プリンター名として、受け付けられるか（空・長すぎる・制御文字を含む、は断る） */
export function validatePrinterName(name: string): string | undefined {
  if (name.trim() === "") return "プリンター名が空です";
  if (name.length > 200) return "プリンター名が長すぎます";
  // biome-ignore lint/suspicious/noControlCharactersInRegex: 制御文字が入っていないことを確かめるため
  if (/[\u0000-\u001f\u007f]/.test(name)) return "プリンター名に、制御文字が含まれています";
  return undefined;
}

/** SumatraPDF の場所を探す。SUMATRA_PATH があればそれ。なければ、よく入る場所を順に探す */
export function resolveSumatraPath(
  env: Record<string, string | undefined>,
  exists: (path: string) => boolean = existsSync,
): string {
  const explicit = env.SUMATRA_PATH?.trim();
  if (explicit) {
    if (!exists(explicit)) {
      throw new Error(`SUMATRA_PATH のファイルが見つかりません: ${explicit}`);
    }
    return explicit;
  }
  // Windows の場所なので、実行している OS に関係なく、Windows の区切り（\）で組み立てる
  const candidates = [
    env.LOCALAPPDATA && win32.join(env.LOCALAPPDATA, "SumatraPDF", "SumatraPDF.exe"),
    env.ProgramFiles && win32.join(env.ProgramFiles, "SumatraPDF", "SumatraPDF.exe"),
    env["ProgramFiles(x86)"] &&
      win32.join(env["ProgramFiles(x86)"], "SumatraPDF", "SumatraPDF.exe"),
  ].filter((path): path is string => Boolean(path));
  const found = candidates.find((path) => exists(path));
  if (!found) {
    throw new Error(
      "SumatraPDF が見つかりません。infra/windows/install-tools.ps1 で入れるか、SUMATRA_PATH に、SumatraPDF.exe の場所を書いてください",
    );
  }
  return found;
}

/** Windows に登録されているプリンターの名前の一覧。PowerShell の出力は UTF-8 にそろえる（日本語の名前が崩れないように） */
export async function listPrinters(runner: Runner = bunRunner): Promise<string[]> {
  const script =
    "[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; Get-Printer | Select-Object -ExpandProperty Name | ConvertTo-Json -Compress";
  const result = await runner(["powershell", "-NoProfile", "-NonInteractive", "-Command", script], {
    timeoutMs: 20_000,
  });
  if (result.exitCode !== 0 || result.timedOut) {
    throw new Error(`プリンターの一覧を取れませんでした: ${result.stderr.trim() || "時間切れ"}`);
  }
  const text = result.stdout.trim();
  if (text === "") return [];
  const parsed: unknown = JSON.parse(text);
  const names = Array.isArray(parsed) ? parsed : [parsed];
  return names.filter((name): name is string => typeof name === "string");
}

export type SumatraOptions = {
  sumatraPath: string;
  printerName: string;
  paper?: string | undefined;
  timeoutMs?: number;
  /** テストで差し替える。既定は、実際にコマンドを起動する */
  runner?: Runner;
};

/**
 * 本番用ドライバー。成功は、SumatraPDF が終了コード 0 で終わった（印刷のジョブを、プリンターに送れた）こと。
 * 用紙が実際に出たかまでは、わからない。**失敗したときも、自動では再試行しない**（用紙がもう出ていたら二重になるため。
 * 印刷係が、スタッフ画面の「印刷確認」で、再印刷を選ぶ）
 */
export function createSumatraDriver(options: SumatraOptions): PrintDriver {
  const runner = options.runner ?? bunRunner;
  const timeoutMs = options.timeoutMs ?? PRINT_TIMEOUT_MS;
  const invalid = validatePrinterName(options.printerName);
  if (invalid) throw new Error(`PRINTER_NAME が正しくありません: ${invalid}`);

  return {
    name: "sumatra",
    print: async (job) => {
      const command = buildSumatraArgs({
        sumatraPath: options.sumatraPath,
        printerName: options.printerName,
        pdfPath: job.pdfPath,
        paper: options.paper,
      });
      let result: RunResult;
      try {
        result = await runner(command, { timeoutMs });
      } catch (cause) {
        const reason = cause instanceof Error ? cause.message : String(cause);
        throw new Error(`SumatraPDF を起動できませんでした（${reason}）`);
      }
      if (result.timedOut) {
        throw new Error(
          `${Math.round(timeoutMs / 1000)} 秒たっても、印刷の送信が終わりません（プリンターが応答していない可能性があります）`,
        );
      }
      if (result.exitCode !== 0) {
        // 出力の最後の数行だけ（SumatraPDF の内部のログは長いので、300 文字までにする）
        const detail = (result.stderr || result.stdout)
          .trim()
          .split("\n")
          .slice(-3)
          .join(" / ")
          .slice(0, 300);
        throw new Error(
          `SumatraPDF が失敗しました（終了コード ${result.exitCode}。プリンター名「${options.printerName}」を確かめてください）${detail ? `: ${detail}` : ""}`,
        );
      }
    },
    preflight: async () => {
      const problems: string[] = [];
      try {
        const printers = await listPrinters(runner);
        const wanted = options.printerName.toLowerCase();
        if (!printers.some((name) => name.toLowerCase() === wanted)) {
          problems.push(
            `プリンター「${options.printerName}」が、Windows に登録されていません。登録されているプリンター：${printers.join("、") || "（なし）"}`,
          );
        }
      } catch (cause) {
        problems.push(cause instanceof Error ? cause.message : String(cause));
      }
      return problems;
    },
  };
}
