import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import {
  buildSumatraArgs,
  createSumatraDriver,
  listPrinters,
  paperSizeName,
  type Runner,
  type RunResult,
  resolveSumatraPath,
  validatePrinterName,
} from "./driver-sumatra";

/** 呼ばれたコマンドを覚え、決めた結果を返す、偽の実行役（実際には、何も起動しない） */
function fakeRunner(result: Partial<RunResult> | (() => Promise<RunResult>) = {}) {
  const calls: { command: string[]; timeoutMs: number }[] = [];
  const runner: Runner = async (command, options) => {
    calls.push({ command, timeoutMs: options.timeoutMs });
    if (typeof result === "function") return await result();
    return { exitCode: 0, stdout: "", stderr: "", timedOut: false, ...result };
  };
  return { runner, calls };
}

const SUMATRA = "C:\\Users\\staff\\AppData\\Local\\SumatraPDF\\SumatraPDF.exe";
const job = { sheetId: "S1", pdfPath: "C:\\data\\sheets\\01 sheet.pdf" };

describe("SumatraPDF に渡す引数", () => {
  test("拡大縮小しない（noscale）・カラー・用紙・静かに（silent）で、指定のプリンターに送る", () => {
    expect(
      buildSumatraArgs({
        sumatraPath: SUMATRA,
        printerName: "Canon TS6730 series",
        pdfPath: "C:\\data\\a.pdf",
        paper: "A4",
      }),
    ).toEqual([
      SUMATRA,
      "-print-to",
      "Canon TS6730 series",
      "-print-settings",
      "noscale,color,paper=A4",
      "-silent",
      "C:\\data\\a.pdf",
    ]);
  });

  test("用紙の指定がなければ、paper は付けない（プリンターの既定）", () => {
    const args = buildSumatraArgs({ sumatraPath: SUMATRA, printerName: "P", pdfPath: "a.pdf" });
    expect(args[4]).toBe("noscale,color");
  });

  test("どの組み合わせでも、noscale が入る（実寸で印刷するための、いちばん大事な指定）", () => {
    for (const paper of [undefined, "A4", "letter"]) {
      const args = buildSumatraArgs({
        sumatraPath: SUMATRA,
        printerName: "P",
        pdfPath: "a.pdf",
        paper,
      });
      expect(args[args.indexOf("-print-settings") + 1]).toContain("noscale");
    }
  });

  test("スペース・引用符・記号を含む名前やパスは、1 つの引数のまま渡る（シェルを通さない）", () => {
    const printerName = `Canon "TS 6730" & (office); echo hi`;
    const pdfPath = "C:\\my data\\sheet $1 & x.pdf";
    const args = buildSumatraArgs({ sumatraPath: SUMATRA, printerName, pdfPath });
    expect(args).toHaveLength(7);
    expect(args[2]).toBe(printerName);
    expect(args[6]).toBe(pdfPath);
  });

  test("用紙の大きさ：A4 などを名前にする。知らない大きさは、指定しない", () => {
    expect(paperSizeName(210, 297)).toBe("A4");
    expect(paperSizeName(210.2, 296.8)).toBe("A4");
    expect(paperSizeName(297, 420)).toBe("A3");
    expect(paperSizeName(100, 100)).toBeUndefined();
  });
});

describe("プリンター名の検証", () => {
  test("ふつうの名前（日本語・スペース・括弧）は通る", () => {
    for (const name of ["Canon TS6730 series", "Canon TS3100 series (1 コピー)", "プリンター 1"]) {
      expect(validatePrinterName(name)).toBeUndefined();
    }
  });

  test("空・空白だけ・長すぎる・制御文字を含む名前は、断る", () => {
    expect(validatePrinterName("")).toContain("空");
    expect(validatePrinterName("   ")).toContain("空");
    expect(validatePrinterName("x".repeat(201))).toContain("長すぎ");
    expect(validatePrinterName("a\nb")).toContain("制御文字");
    expect(validatePrinterName("a\u0000b")).toContain("制御文字");
  });
});

describe("SumatraPDF の場所", () => {
  const present =
    (...paths: string[]) =>
    (path: string) =>
      paths.includes(path);

  test("SUMATRA_PATH があれば、それを使う。ファイルがなければ、分かる文で断る", () => {
    expect(
      resolveSumatraPath(
        { SUMATRA_PATH: "D:\\tools\\Sumatra.exe" },
        present("D:\\tools\\Sumatra.exe"),
      ),
    ).toBe("D:\\tools\\Sumatra.exe");
    expect(() => resolveSumatraPath({ SUMATRA_PATH: "D:\\none.exe" }, present())).toThrow(
      "SUMATRA_PATH",
    );
  });

  test("指定がなければ、ユーザーの場所 → Program Files の順に探す（winget の既定の場所）", () => {
    const env = { LOCALAPPDATA: "C:\\Users\\u\\AppData\\Local", ProgramFiles: "C:\\Program Files" };
    const user = "C:\\Users\\u\\AppData\\Local\\SumatraPDF\\SumatraPDF.exe";
    const system = "C:\\Program Files\\SumatraPDF\\SumatraPDF.exe";
    expect(resolveSumatraPath(env, present(user, system))).toBe(user);
    expect(resolveSumatraPath(env, present(system))).toBe(system);
  });

  test("どこにもなければ、入れ方を案内する", () => {
    expect(() => resolveSumatraPath({ LOCALAPPDATA: "C:\\L" }, present())).toThrow(
      "install-tools.ps1",
    );
  });
});

describe("プリンターの一覧", () => {
  test("PowerShell の出力（JSON）を読む。1 台でも、複数台でも、0 台でも", async () => {
    expect(
      await listPrinters(fakeRunner({ stdout: '["A","Canon TS3100 series (1 コピー)"]' }).runner),
    ).toEqual(["A", "Canon TS3100 series (1 コピー)"]);
    expect(await listPrinters(fakeRunner({ stdout: '"Only One"' }).runner)).toEqual(["Only One"]);
    expect(await listPrinters(fakeRunner({ stdout: "" }).runner)).toEqual([]);
  });

  test("出力を UTF-8 にそろえてから、一覧を取る（日本語の名前が崩れないように）。引数は配列", async () => {
    const { runner, calls } = fakeRunner({ stdout: "[]" });
    await listPrinters(runner);
    const command = calls[0]?.command ?? [];
    expect(command[0]).toBe("powershell");
    expect(command.join(" ")).toContain("OutputEncoding");
    expect(command.join(" ")).toContain("Get-Printer");
  });

  test("取れなかったとき・時間切れのときは、理由つきで失敗する", async () => {
    await expect(
      listPrinters(fakeRunner({ exitCode: 1, stderr: "denied" }).runner),
    ).rejects.toThrow("denied");
    await expect(listPrinters(fakeRunner({ timedOut: true, exitCode: 1 }).runner)).rejects.toThrow(
      "プリンターの一覧",
    );
  });
});

describe("本番用ドライバー", () => {
  const make = (result: Partial<RunResult> | (() => Promise<RunResult>) = {}, extra = {}) => {
    const fake = fakeRunner(result);
    const driver = createSumatraDriver({
      sumatraPath: SUMATRA,
      printerName: "Canon TS6730 series",
      paper: "A4",
      runner: fake.runner,
      ...extra,
    });
    return { driver, ...fake };
  };

  test("成功（終了コード 0）：SumatraPDF を、決めた引数で、1 回だけ起動する", async () => {
    const { driver, calls } = make();
    await driver.print(job);
    expect(driver.name).toBe("sumatra");
    expect(calls).toHaveLength(1);
    expect(calls[0]?.command).toEqual([
      SUMATRA,
      "-print-to",
      "Canon TS6730 series",
      "-print-settings",
      "noscale,color,paper=A4",
      "-silent",
      job.pdfPath,
    ]);
  });

  test("終了コードが 0 でなければ、失敗。プリンター名と、出力の最後の数行が、文に入る", async () => {
    const { driver } = make({ exitCode: 1, stderr: "line1\nline2\nline3\nprinter not found" });
    await expect(driver.print(job)).rejects.toThrow("終了コード 1");
    await expect(driver.print(job)).rejects.toThrow("Canon TS6730 series");
    await expect(driver.print(job)).rejects.toThrow("printer not found");
  });

  test("時間切れ：プリンターが応答していない可能性を伝える。決めた時間で、実行役に渡す", async () => {
    const { driver, calls } = make({ timedOut: true, exitCode: 1 }, { timeoutMs: 5000 });
    await expect(driver.print(job)).rejects.toThrow("5 秒たっても");
    expect(calls[0]?.timeoutMs).toBe(5000);
  });

  test("既定の時間切れは、60 秒", async () => {
    const { driver, calls } = make();
    await driver.print(job);
    expect(calls[0]?.timeoutMs).toBe(60_000);
  });

  test("起動できないとき（ファイルがないなど）も、分かる文で失敗する", async () => {
    const { driver } = make(async () => {
      throw new Error("ENOENT");
    });
    await expect(driver.print(job)).rejects.toThrow("SumatraPDF を起動できませんでした");
  });

  test("失敗しても、自動で再試行しない（二重印刷を避ける）：実行は 1 回だけ", async () => {
    const { driver, calls } = make({ exitCode: 1 });
    await expect(driver.print(job)).rejects.toThrow();
    expect(calls).toHaveLength(1);
  });

  test("正しくないプリンター名では、ドライバーを作れない", () => {
    expect(() => createSumatraDriver({ sumatraPath: SUMATRA, printerName: "" })).toThrow(
      "PRINTER_NAME",
    );
    expect(() => createSumatraDriver({ sumatraPath: SUMATRA, printerName: "a\nb" })).toThrow(
      "制御文字",
    );
  });
});

describe("起動時の確認（preflight）", () => {
  const driverWith = (stdout: string, result: Partial<RunResult> = {}) =>
    createSumatraDriver({
      sumatraPath: SUMATRA,
      printerName: "Canon TS6730 series",
      runner: fakeRunner({ stdout, ...result }).runner,
    });

  test("プリンターが登録されていれば、問題なし（大文字小文字は問わない）", async () => {
    expect(await driverWith('["canon ts6730 SERIES","Other"]').preflight?.()).toEqual([]);
  });

  test("登録されていなければ、登録されているプリンターの一覧つきで知らせる", async () => {
    const problems = (await driverWith('["Other A","Other B"]').preflight?.()) ?? [];
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("Canon TS6730 series");
    expect(problems[0]).toContain("Other A、Other B");
  });

  test("一覧を取れなくても、例外にせず、問題として知らせる", async () => {
    const problems = (await driverWith("", { exitCode: 1, stderr: "boom" }).preflight?.()) ?? [];
    expect(problems[0]).toContain("boom");
  });
});

const hasSumatra =
  process.platform === "win32" &&
  existsSync(`${process.env.LOCALAPPDATA}\\SumatraPDF\\SumatraPDF.exe`);

describe("実際の SumatraPDF（Windows で、入っているときだけ）", () => {
  test.skipIf(!hasSumatra)(
    "存在しないプリンターを指定すると、失敗として返る（用紙は出ない）",
    async () => {
      const driver = createSumatraDriver({
        sumatraPath: `${process.env.LOCALAPPDATA}\\SumatraPDF\\SumatraPDF.exe`,
        printerName: "canbadge-no-such-printer-for-test",
        paper: "A4",
        timeoutMs: 30_000,
      });
      const pdf = `${process.env.TEMP}\\canbadge-p03-test.pdf`;
      await Bun.write(pdf, "%PDF-1.4\n%%EOF\n");
      await expect(driver.print({ sheetId: "t", pdfPath: pdf })).rejects.toThrow(
        "SumatraPDF が失敗しました",
      );
    },
    40_000,
  );
});
