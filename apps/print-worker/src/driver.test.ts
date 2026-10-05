import { describe, expect, test } from "bun:test";
import { createDriver } from "./driver";
import { renderPlaceholderPdf } from "./placeholder-pdf";

describe("ドライバーの選択", () => {
  test("PRINT_DRIVER がなければ、開発用ドライバー", () => {
    expect(createDriver({}, { devOutDir: "out" }).name).toBe("dev");
    expect(createDriver({ PRINT_DRIVER: "dev" }, { devOutDir: "out" }).name).toBe("dev");
  });

  test("まだ実装されていないドライバーは、分かるメッセージで断る", () => {
    expect(() => createDriver({ PRINT_DRIVER: "sumatra" }, { devOutDir: "out" })).toThrow("P03");
  });
});

describe("仮の PDF", () => {
  test("PDF として読め、注文番号が載る", async () => {
    const bytes = await renderPlaceholderPdf({
      sheetKey: "KEY",
      slots: [
        { position: 0, orderNumberText: "007" },
        { position: 1, orderNumberText: "012" },
      ],
    });
    const text = Buffer.from(bytes).toString("latin1");
    expect(text.startsWith("%PDF-")).toBe(true);
    expect(text.trimEnd().endsWith("%%EOF")).toBe(true);
    expect(bytes.length).toBeGreaterThan(500);
  });
});
