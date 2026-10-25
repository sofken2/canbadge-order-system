import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  databasePath,
  listAuditLogsSince,
  openDatabase,
  schema,
  toArchiveEntry,
  toAuditLog,
  toDesign,
  toOrder,
  toOrderItem,
  toPrintSheet,
  toPrintSlot,
  toReport,
  toSetting,
} from "@canbadge/db";
import {
  archiveStatusSchema,
  orderItemStatusSchema,
  orderStatusSchema,
  printSheetStatusSchema,
  printSlotResultSchema,
} from "@canbadge/shared";
import { SEED_MARKER_ACTION, seedSampleData } from "./seed";

const NOW = new Date("2026-11-03T12:00:00+09:00");

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "canbadge-fixtures-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
});

describe("サンプルデータ", () => {
  test("すべての状態の注文・明細・印刷シート・シート上の結果・アーカイブ作品がそろう", () => {
    seedSampleData({ dataDir: dir, now: NOW });
    const db = openDatabase({ path: databasePath(dir), migrate: false });
    const distinct = (rows: { status: string }[]) => [...new Set(rows.map((r) => r.status))].sort();

    expect(distinct(db.orm.select().from(schema.orders).all())).toEqual(
      [...orderStatusSchema.options].sort(),
    );
    expect(distinct(db.orm.select().from(schema.orderItems).all())).toEqual(
      [...orderItemStatusSchema.options].sort(),
    );
    expect(distinct(db.orm.select().from(schema.printSheets).all())).toEqual(
      [...printSheetStatusSchema.options].sort(),
    );
    expect(distinct(db.orm.select().from(schema.archiveEntries).all())).toEqual(
      [...archiveStatusSchema.options].sort(),
    );
    const results = new Set(
      db.orm
        .select()
        .from(schema.printSlots)
        .all()
        .map((s) => s.result),
    );
    expect([...results].sort()).toEqual([...printSlotResultSchema.options].sort());
    db.close();
  });

  test("すべての行が契約（zod）に合う。操作ログもそろう", () => {
    seedSampleData({ dataDir: dir, now: NOW });
    const db = openDatabase({ path: databasePath(dir), migrate: false });
    const o = db.orm;
    expect(() => {
      o.select().from(schema.designs).all().map(toDesign);
      o.select().from(schema.orders).all().map(toOrder);
      o.select().from(schema.orderItems).all().map(toOrderItem);
      o.select().from(schema.printSheets).all().map(toPrintSheet);
      o.select().from(schema.printSlots).all().map(toPrintSlot);
      o.select().from(schema.archiveEntries).all().map(toArchiveEntry);
      o.select().from(schema.reports).all().map(toReport);
      o.select().from(schema.auditLogs).all().map(toAuditLog);
      toSetting(o.select().from(schema.settings).get() as never);
    }).not.toThrow();

    const actions = new Set(listAuditLogsSince(db, 0, 10_000).map((e) => e.log.action));
    for (const action of [
      "business_day.open",
      "acceptance.set",
      "order.create",
      "order.transition",
      "order_item.transition",
      "print_sheet.create",
      "print_sheet.transition",
      SEED_MARKER_ACTION,
    ]) {
      expect(actions).toContain(action);
    }
    db.close();
  });

  test("注文の状態と、シナリオ上の名前が対応している", () => {
    const summary = seedSampleData({ dataDir: dir, now: NOW });
    const status = (name: string) => summary.orders[name]?.status;
    expect({
      expired: status("expired"),
      cancelled: status("cancelled"),
      refunded: status("refunded"),
      pickedUp: status("pickedUp"),
      readyLong: status("readyLong"),
      readyNew: status("readyNew"),
      assembling: status("assembling"),
      printedA: status("printedA"),
      printedB: status("printedB"),
      reprintPrinting: status("reprintPrinting"),
      failedWaiting: status("failedWaiting"),
      queued: status("queued"),
      waiting: status("waiting"),
    }).toEqual({
      expired: "expired",
      cancelled: "cancelled",
      refunded: "refunded",
      pickedUp: "picked_up",
      readyLong: "ready",
      readyNew: "ready",
      assembling: "assembling",
      printedA: "assembling",
      printedB: "assembling",
      reprintPrinting: "paid",
      failedWaiting: "paid",
      queued: "paid",
      waiting: "submitted",
    });
    expect(summary.businessDate).toBe("2026-11-03");
    // 注文番号は営業日の 1 から連番で、重複しない
    const numbers = Object.values(summary.orders)
      .map((o) => o.orderNumber)
      .sort((a, b) => a - b);
    expect(numbers).toEqual(Array.from({ length: numbers.length }, (_, i) => i + 1));
  });

  test("完成してから時間がたった注文と、新しい注文がある（長時間未受け取りの確認用）", () => {
    const summary = seedSampleData({ dataDir: dir, now: NOW });
    const db = openDatabase({ path: databasePath(dir), migrate: false });
    const readyAt = (name: string) =>
      toOrder(
        db.orm
          .select()
          .from(schema.orders)
          .all()
          .find((r) => r.id === summary.orders[name]?.orderId) as never,
      ).readyAt;
    const long = new Date(readyAt("readyLong") ?? "").getTime();
    const fresh = new Date(readyAt("readyNew") ?? "").getTime();
    expect(NOW.getTime() - long).toBeGreaterThan(30 * 60_000);
    expect(fresh - long).toBeGreaterThanOrEqual(25 * 60_000);
    expect(fresh).toBeLessThanOrEqual(NOW.getTime());
    db.close();
  });

  test("DB が指す画像と PDF のファイルが、実際に存在する（PNG と PDF として読める）", () => {
    seedSampleData({ dataDir: dir, now: NOW });
    const db = openDatabase({ path: databasePath(dir), migrate: false });
    for (const design of db.orm.select().from(schema.designs).all()) {
      const file = join(dir, design.imagePath);
      expect(existsSync(file)).toBe(true);
      expect([...readFileSync(file).subarray(1, 4)]).toEqual([0x50, 0x4e, 0x47]);
    }
    for (const sheet of db.orm.select().from(schema.printSheets).all()) {
      const file = join(dir, sheet.pdfPath);
      expect(existsSync(file)).toBe(true);
      expect(readFileSync(file).subarray(0, 5).toString()).toBe("%PDF-");
    }
    db.close();
  });

  test("アーカイブ作品をコピーした注文は、元の作品を指す。同じ来場者の注文が 2 件ある", () => {
    const summary = seedSampleData({ dataDir: dir, now: NOW });
    const db = openDatabase({ path: databasePath(dir), migrate: false });
    const orderId = summary.orders.waitingFromArchive?.orderId;
    const item = db.orm
      .select()
      .from(schema.orderItems)
      .all()
      .find((i) => i.orderId === orderId);
    const design = db.orm
      .select()
      .from(schema.designs)
      .all()
      .find((d) => d.id === item?.designId);
    const entry = db.orm
      .select()
      .from(schema.archiveEntries)
      .all()
      .find((e) => e.id === design?.sourceArchiveEntryId);
    expect(entry?.status).toBe("public");

    const tokens = db.orm
      .select()
      .from(schema.orders)
      .all()
      .map((o) => o.anonToken);
    expect(tokens.filter((t) => t === tokens[tokens.length - 1])).toHaveLength(2);
    db.close();
  });

  test("同じ時刻で作れば、毎回同じ内容になる", () => {
    const a = seedSampleData({ dataDir: dir, now: NOW });
    rmSync(join(dir, "app.db"), { force: true });
    rmSync(join(dir, "app.db-wal"), { force: true });
    rmSync(join(dir, "app.db-shm"), { force: true });
    const b = seedSampleData({ dataDir: dir, now: NOW });
    const shape = (s: typeof a) =>
      Object.entries(s.orders).map(([name, o]) => [name, o.orderNumber, o.status]);
    expect(shape(b)).toEqual(shape(a));
  });
});
