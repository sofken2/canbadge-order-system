import { describe, expect, test } from "bun:test";
import { createDriver } from "./driver";

describe("ドライバーの選択", () => {
  test("PRINT_DRIVER がなければ、開発用ドライバー", () => {
    expect(createDriver({}, { devOutDir: "out" }).name).toBe("dev");
    expect(createDriver({ PRINT_DRIVER: "dev" }, { devOutDir: "out" }).name).toBe("dev");
  });

  test("知らないドライバーは、分かるメッセージで断る", () => {
    expect(() => createDriver({ PRINT_DRIVER: "cups" }, { devOutDir: "out" })).toThrow(
      "dev か sumatra",
    );
  });

  test("sumatra は、PRINTER_NAME がなければ、名前の調べ方つきで断る", () => {
    if (process.platform !== "win32") return;
    expect(() => createDriver({ PRINT_DRIVER: "sumatra" }, { devOutDir: "out" })).toThrow(
      "bun run printers",
    );
    expect(() =>
      createDriver({ PRINT_DRIVER: "sumatra", PRINTER_NAME: "  " }, { devOutDir: "out" }),
    ).toThrow("PRINTER_NAME");
  });

  test("sumatra：PRINTER_NAME と、SumatraPDF の場所があれば、本番用ドライバーになる", () => {
    if (process.platform !== "win32") return;
    // 場所の確認は、ファイルがあるかだけ（起動しない）。実行中の bun 自身を、代わりに指す
    const driver = createDriver(
      {
        PRINT_DRIVER: "sumatra",
        PRINTER_NAME: "Canon TS6730 series",
        SUMATRA_PATH: process.execPath,
      },
      { devOutDir: "out" },
    );
    expect(driver.name).toBe("sumatra");
    expect(driver.preflight).toBeDefined();
  });

  test("sumatra は Windows 以外では、使えないと、分かる文で断る", () => {
    if (process.platform === "win32") return;
    expect(() =>
      createDriver({ PRINT_DRIVER: "sumatra", PRINTER_NAME: "P" }, { devOutDir: "out" }),
    ).toThrow("Windows");
  });
});
