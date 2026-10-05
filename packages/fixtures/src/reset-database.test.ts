import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createOrder, databasePath, openDatabase } from "@canbadge/db";
import { resetAndSeed } from "./reset-database";

const NOW = new Date("2026-11-03T12:00:00+09:00");

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "canbadge-reset-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
});

function orderCount(): number {
  const db = openDatabase({ path: databasePath(dir), migrate: false });
  const n = (db.sqlite.query("SELECT count(*) AS n FROM orders").get() as { n: number }).n;
  db.close();
  return n;
}

/** サンプルのあとに、本物の注文が入った状況を作る */
function addRealOrder(): void {
  const db = openDatabase({ path: databasePath(dir), migrate: false });
  createOrder(db, {
    imagePath: "images/sample-rings.png",
    editorData: { version: 1 },
    quantity: 1,
    anonToken: "real-visitor-token-0000000000",
  });
  db.close();
}

describe("db:reset", () => {
  test("DB がなくても作れ、何度実行しても同じサンプルデータになる", () => {
    const first = resetAndSeed({ dataDir: dir, now: NOW });
    const count = orderCount();
    expect(count).toBe(Object.keys(first.orders).length);
    resetAndSeed({ dataDir: dir, now: NOW });
    expect(orderCount()).toBe(count);
  });

  test("画像・PDF も作り直され、前に置いたファイルは消える", () => {
    resetAndSeed({ dataDir: dir, now: NOW });
    const stray = join(dir, "images", "uploaded-by-hand.png");
    Bun.write(stray, "x");
    resetAndSeed({ dataDir: dir, now: NOW });
    expect(existsSync(stray)).toBe(false);
    expect(existsSync(join(dir, "images", "sample-rings.png"))).toBe(true);
  });

  test("サンプルのあとに本物の注文が入った DB は、--force なしでは消さない", () => {
    resetAndSeed({ dataDir: dir, now: NOW });
    const before = orderCount();
    addRealOrder();
    expect(() => resetAndSeed({ dataDir: dir, now: NOW })).toThrow("db:reset:force");
    expect(orderCount()).toBe(before + 1);
  });

  test("--force を付ければ、本物の注文があっても消して作り直す", () => {
    resetAndSeed({ dataDir: dir, now: NOW });
    addRealOrder();
    const summary = resetAndSeed({ dataDir: dir, force: true, now: NOW });
    expect(orderCount()).toBe(Object.keys(summary.orders).length);
  });

  test("注文が 1 件もない DB は、そのまま作り直せる", () => {
    openDatabase({ path: databasePath(dir) }).close();
    expect(() => resetAndSeed({ dataDir: dir, now: NOW })).not.toThrow();
  });
});
