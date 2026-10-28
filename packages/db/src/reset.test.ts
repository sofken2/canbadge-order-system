import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createArchiveEntry } from "./archive";
import { listAuditLogsSince } from "./audit";
import { type Database, openDatabase } from "./connection";
import { DbError } from "./errors";
import { getSetting } from "./queries";
import { getResetSummary, resetEventData } from "./reset";
import { setAcceptance } from "./settings";
import { createPrintSheet } from "./sheets";
import { getStockRemaining } from "./stock";
import { paidOrder, setup, uniqueToken } from "./test-helpers";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** データ置き場（画像と PDF のフォルダに、ファイルが 1 つずつある） */
function dataDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "canbadge-reset-"));
  dirs.push(dir);
  mkdirSync(join(dir, "images"));
  mkdirSync(join(dir, "sheets"));
  writeFileSync(join(dir, "images", "a.png"), "image");
  writeFileSync(join(dir, "sheets", "s.pdf"), "pdf");
  return dir;
}

function codeOf(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (error) {
    if (error instanceof DbError) return error.code;
    throw error;
  }
  return undefined;
}

/** 注文（支払い済み 2 件）・印刷シート・アーカイブの投稿がある、営業中の状態 */
function withData(db: Database) {
  const a = paidOrder(db);
  paidOrder(db);
  createArchiveEntry(db, {
    imagePath: "images/a.png",
    editorData: { version: 1 },
    displayName: "たろう",
    consent: { selfMade: true, allowOthersToOrder: true },
    authorAnonToken: uniqueToken(),
  });
  return a;
}

describe("イベントデータのリセット", () => {
  test("消える件数を数える。受付が終了していなければ、実行できない理由が出る", () => {
    const { db } = setup();
    withData(db);
    const summary = getResetSummary(db);
    expect(summary.counts).toEqual({
      orders: 2,
      unfinishedOrders: 2,
      printSheets: 0,
      archiveEntries: 1,
      reports: 0,
    });
    expect(summary.blockers).toEqual(["acceptance_not_closed"]);
  });

  test("受付が終了していなければ、断る。何も消えず、退避も作らない", () => {
    const { db } = setup();
    withData(db);
    const dir = dataDir();
    expect(codeOf(() => resetEventData(db, { dataDir: dir, actor: "staff" }))).toBe(
      "INVALID_TRANSITION",
    );
    expect(getResetSummary(db).counts.orders).toBe(2);
    expect(readdirSync(dir).sort()).toEqual(["images", "sheets"]);
  });

  test("印刷中のシートがあれば、断る", () => {
    const { db } = setup();
    const a = withData(db);
    createPrintSheet(db, { pdfPath: "sheets/s.pdf", orderItemIds: [a.items[0]?.id ?? ""] });
    setAcceptance(db, { acceptance: "closed", actor: "staff" });
    expect(getResetSummary(db).blockers).toEqual(["print_sheet_printing"]);
    expect(codeOf(() => resetEventData(db, { dataDir: dataDir(), actor: "staff" }))).toBe(
      "INVALID_TRANSITION",
    );
  });

  test("消すと、注文・印刷・アーカイブが空になり、営業開始の前に戻る。設定の値は残る", () => {
    const { db } = setup();
    withData(db);
    const before = getSetting(db.orm);
    setAcceptance(db, { acceptance: "closed", actor: "staff" });
    const dir = dataDir();

    const result = resetEventData(db, { dataDir: dir, actor: "staff" });
    expect(result.deleted.orders).toBe(2);
    expect(result.deleted.archiveEntries).toBe(1);

    expect(getResetSummary(db).counts).toEqual({
      orders: 0,
      unfinishedOrders: 0,
      printSheets: 0,
      archiveEntries: 0,
      reports: 0,
    });
    const after = getSetting(db.orm);
    expect(after.businessDate).toBeNull();
    expect(after.acceptance).toBe("closed");
    // 設定の値は、そのまま
    expect(after.price).toBe(before.price);
    expect(after.badgeStock).toBe(before.badgeStock);
    expect(after.printMaxWaitSeconds).toBe(before.printMaxWaitSeconds);
  });

  test("残りの数は、注文を消すと、総数に戻る", () => {
    const { db } = setup();
    withData(db);
    const used = getStockRemaining(db.orm, getSetting(db.orm));
    expect(used.badge).toBe(getSetting(db.orm).badgeStock - 2);
    setAcceptance(db, { acceptance: "closed", actor: "staff" });
    resetEventData(db, { dataDir: dataDir(), actor: "staff" });
    const setting = getSetting(db.orm);
    expect(getStockRemaining(db.orm, setting).badge).toBe(setting.badgeStock);
  });

  test("消す前に、DB・画像・PDF を old-<日時>/ に退避する。画像と PDF のフォルダは、空で作り直す", () => {
    const { db } = setup();
    withData(db);
    setAcceptance(db, { acceptance: "closed", actor: "staff" });
    const dir = dataDir();

    const { backupName } = resetEventData(db, { dataDir: dir, actor: "staff" });
    expect(backupName).toMatch(/^old-\d{8}-\d{6}$/);
    const backup = join(dir, backupName);
    expect(existsSync(join(backup, "app.db"))).toBe(true);
    expect(existsSync(join(backup, "images", "a.png"))).toBe(true);
    expect(existsSync(join(backup, "sheets", "s.pdf"))).toBe(true);
    expect(readdirSync(join(dir, "images"))).toEqual([]);
    expect(readdirSync(join(dir, "sheets"))).toEqual([]);

    // 退避した DB には、消す前の注文が入っている（あとから戻せる）
    const saved = openDatabase({ path: join(backup, "app.db") });
    try {
      expect(getResetSummary(saved).counts.orders).toBe(2);
    } finally {
      saved.close();
    }
  });

  test("操作ログは消すが、通し番号は戻さない（画面の更新の通知が、取りこぼされない）。リセットの記録が 1 件残る", () => {
    const { db } = setup();
    withData(db);
    setAcceptance(db, { acceptance: "closed", actor: "staff" });
    const lastSeq = Math.max(...listAuditLogsSince(db, 0, 1000).map((row) => row.seq));

    resetEventData(db, { dataDir: dataDir(), actor: "staff" });
    const logs = listAuditLogsSince(db, 0, 1000);
    expect(logs.map((row) => row.log.action)).toEqual(["event.reset"]);
    expect(logs[0]?.seq).toBeGreaterThan(lastSeq);
  });

  test("リセットしたあとは、営業を開始して、注文番号が 1 から始まる", async () => {
    const { db } = setup();
    withData(db);
    setAcceptance(db, { acceptance: "closed", actor: "staff" });
    resetEventData(db, { dataDir: dataDir(), actor: "staff" });

    const { openBusinessDay } = await import("./settings");
    openBusinessDay(db, { actor: "staff" });
    expect(paidOrder(db).order.orderNumber).toBe(1);
  });
});
