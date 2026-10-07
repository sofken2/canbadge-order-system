import { describe, expect, test } from "bun:test";
import { createDriver } from "./driver";

describe("ドライバーの選択", () => {
  test("PRINT_DRIVER がなければ、開発用ドライバー", () => {
    expect(createDriver({}, { devOutDir: "out" }).name).toBe("dev");
    expect(createDriver({ PRINT_DRIVER: "dev" }, { devOutDir: "out" }).name).toBe("dev");
  });

  test("まだ実装されていないドライバーは、分かるメッセージで断る", () => {
    expect(() => createDriver({ PRINT_DRIVER: "sumatra" }, { devOutDir: "out" })).toThrow("P03");
  });
});
