import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createManualClock } from "./clock";
import { openDatabase } from "./connection";
import { createOrder } from "./orders";
import { orderItems } from "./schema";
import { openBusinessDay } from "./settings";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "canbadge-db-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("DB の接続", () => {
  test("WAL モード・ビジータイムアウト・外部キーが設定される", () => {
    const db = openDatabase({ path: join(dir, "app.db") });
    expect(db.sqlite.query("PRAGMA journal_mode").get()).toEqual({ journal_mode: "wal" });
    expect(db.sqlite.query("PRAGMA busy_timeout").get()).toEqual({ timeout: 5000 });
    expect(db.sqlite.query("PRAGMA foreign_keys").get()).toEqual({ foreign_keys: 1 });
    db.close();
  });

  test("保存先のフォルダがなくても作る。マイグレーションは何度開いても安全で、設定の行は 1 つだけ", () => {
    const path = join(dir, "nested", "data", "app.db");
    openDatabase({ path }).close();
    const again = openDatabase({ path });
    expect(again.sqlite.query("SELECT count(*) AS n FROM settings").get()).toEqual({ n: 1 });
    expect(
      again.sqlite
        .query("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'orders'")
        .get(),
    ).toEqual({ name: "orders" });
    again.close();
  });

  test("外部キーが効く（存在しない注文の明細は作れない）", () => {
    const db = openDatabase({ path: ":memory:" });
    expect(() =>
      db.orm
        .insert(orderItems)
        .values({
          id: "01HZX3V5Q8N4M6T2B9C7D1E0FA",
          orderId: "01HZX3V5Q8N4M6T2B9C7D1E0FB",
          designId: "01HZX3V5Q8N4M6T2B9C7D1E0FC",
          quantity: 1,
          status: "queued",
          printCount: 0,
        })
        .run(),
    ).toThrow();
    db.close();
  });

  test("2 つの接続で同じファイルを使っても、注文番号は重複しない", () => {
    const path = join(dir, "app.db");
    const clock = createManualClock("2026-11-03T09:00:00+09:00");
    const a = openDatabase({ path, now: clock.now });
    openBusinessDay(a, { actor: "staff" });
    const b = openDatabase({ path, now: clock.now });
    const input = {
      imagePath: "images/a.png",
      editorData: { version: 1 },
      quantity: 1,
      anonToken: "t".repeat(32),
    };
    const numbers = [a, b, a, b, a, b].map((db) => createOrder(db, input).order.orderNumber);
    expect(numbers).toEqual([1, 2, 3, 4, 5, 6]);
    a.close();
    b.close();
  });
});

describe("別プロセスからの同時採番", () => {
  test("2 つのプロセスが同時に注文を作っても、番号は 1 から連番で重複しない", async () => {
    const path = join(dir, "app.db");
    const setupDb = openDatabase({ path, now: createManualClock("2026-11-03T09:00:00+09:00").now });
    openBusinessDay(setupDb, { actor: "staff" });
    setupDb.close();

    const worker = fileURLToPath(new URL("./numbering-worker.ts", import.meta.url));
    const spawn = () =>
      Bun.spawn([process.execPath, "run", worker, path, "40"], { stdout: "pipe", stderr: "pipe" });
    const processes = [spawn(), spawn()];
    const codes = await Promise.all(processes.map((p) => p.exited));
    const errors = await Promise.all(processes.map((p) => new Response(p.stderr).text()));
    expect({ codes, errors }).toEqual({ codes: [0, 0], errors: ["", ""] });

    const check = openDatabase({ path, migrate: false });
    const rows = check.sqlite
      .query("SELECT order_number AS n FROM orders ORDER BY order_number")
      .all() as { n: number }[];
    check.close();
    expect(rows.map((r) => r.n)).toEqual(Array.from({ length: 80 }, (_, i) => i + 1));
  }, 60_000);
});
