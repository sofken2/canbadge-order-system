import { Database as SqliteDatabase } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { backupData, restoreData, snapshotName, verifyDatabase } from "./backup";
import { type Database, openDatabase } from "./connection";
import { databasePath, imagesDir } from "./paths";
import { openBusinessDay } from "./settings";
import { placeOrder } from "./test-helpers";

let root: string;
let dataDir: string;
let backupDir: string;
const opened: Database[] = [];

function open(path: string): Database {
  const db = openDatabase({ path });
  opened.push(db);
  return db;
}

/** 営業を開始した DB を開く（営業開始前は、注文を受け付けない） */
function openWithBusinessDay(path: string): Database {
  const db = open(path);
  openBusinessDay(db, { actor: "staff" });
  return db;
}

function countOrders(path: string): number {
  const sqlite = new SqliteDatabase(path, { readonly: true });
  try {
    return (sqlite.query("SELECT COUNT(*) AS n FROM orders").get() as { n: number }).n;
  } finally {
    sqlite.close();
  }
}

function writeImage(name: string, content: string): void {
  mkdirSync(imagesDir(dataDir), { recursive: true });
  writeFileSync(join(imagesDir(dataDir), name), content);
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "canbadge-backup-"));
  dataDir = join(root, "data");
  backupDir = join(root, "backup");
  mkdirSync(dataDir, { recursive: true });
});

afterEach(() => {
  // Windows では、DB を閉じてからでないとフォルダを消せない
  for (const db of opened.splice(0)) db.close();
  rmSync(root, { recursive: true, force: true });
});

const at = (iso: string) => new Date(iso);

describe("バックアップ", () => {
  test("DB の整合性のあるコピーと、画像のコピーを作る", () => {
    const db = openWithBusinessDay(databasePath(dataDir));
    placeOrder(db);
    placeOrder(db);
    writeImage("a.png", "image-a");

    const result = backupData({ dataDir, backupDir, now: at("2026-11-03T10:00:00") });

    expect(result.snapshotDir).toBe(join(backupDir, "snapshots", "20261103-100000"));
    expect(result.imagesCopied).toBe(1);
    expect(countOrders(join(result.snapshotDir, "app.db"))).toBe(2);
    expect(readFileSync(join(backupDir, "images", "a.png"), "utf8")).toBe("image-a");
    expect(JSON.parse(readFileSync(join(backupDir, "latest.json"), "utf8")).snapshot).toBe(
      "20261103-100000",
    );
    expect(() => verifyDatabase(join(result.snapshotDir, "app.db"))).not.toThrow();
  });

  test("DB を使っている最中（別の接続が開いたまま・書き込み後）でも、取れる", () => {
    const writer = openWithBusinessDay(databasePath(dataDir));
    placeOrder(writer);
    // WAL に書いたまま、チェックポイントされていない状態でも、複製に入る
    placeOrder(writer);
    const result = backupData({ dataDir, backupDir, now: at("2026-11-03T10:00:00") });
    expect(countOrders(join(result.snapshotDir, "app.db"))).toBe(2);

    // バックアップのあとも、もとの DB に書ける（バックアップが、ロックを残さない）
    expect(() => placeOrder(writer)).not.toThrow();
  });

  test("画像は、増えた分だけを足す。コピー先から消えた元の画像は、消さない", () => {
    const db = openWithBusinessDay(databasePath(dataDir));
    placeOrder(db);
    writeImage("a.png", "image-a");
    backupData({ dataDir, backupDir, now: at("2026-11-03T10:00:00") });

    writeImage("b.png", "image-b");
    rmSync(join(imagesDir(dataDir), "a.png"));
    const second = backupData({ dataDir, backupDir, now: at("2026-11-03T10:05:00") });

    expect(second.imagesCopied).toBe(1);
    expect(readdirSync(join(backupDir, "images")).sort()).toEqual(["a.png", "b.png"]);
  });

  test("古いスナップショットから消して、指定した数だけ残す", () => {
    openWithBusinessDay(databasePath(dataDir));
    for (const minute of ["00", "05", "10", "15"]) {
      backupData({ dataDir, backupDir, keep: 2, now: at(`2026-11-03T10:${minute}:00`) });
    }
    expect(readdirSync(join(backupDir, "snapshots")).sort()).toEqual([
      "20261103-101000",
      "20261103-101500",
    ]);
  });

  test("途中で止まった一時フォルダは、次のバックアップで片づく。完成扱いにはならない", () => {
    openWithBusinessDay(databasePath(dataDir));
    const leftover = join(backupDir, "snapshots", "20261103-095500.partial");
    mkdirSync(leftover, { recursive: true });
    writeFileSync(join(leftover, "app.db"), "壊れた途中のファイル");

    backupData({ dataDir, backupDir, now: at("2026-11-03T10:00:00") });

    expect(existsSync(leftover)).toBe(false);
    expect(readdirSync(join(backupDir, "snapshots"))).toEqual(["20261103-100000"]);
  });

  test("DB がないときは、何も作らずに失敗する", () => {
    expect(() => backupData({ dataDir, backupDir })).toThrow("DB ファイルがありません");
    expect(existsSync(join(backupDir, "snapshots", snapshotName(new Date())))).toBe(false);
  });

  test("壊れた DB は、検証で見つかる", () => {
    const path = join(root, "broken.db");
    writeFileSync(path, "SQLite ではないファイル".repeat(100));
    expect(() => verifyDatabase(path)).toThrow();
  });
});

describe("復旧", () => {
  test("バックアップから、別のデータ置き場に DB と画像を復旧できる（予備機の想定）", () => {
    const db = openWithBusinessDay(databasePath(dataDir));
    placeOrder(db);
    placeOrder(db);
    writeImage("a.png", "image-a");
    backupData({ dataDir, backupDir, now: at("2026-11-03T10:00:00") });
    placeOrder(db);
    backupData({ dataDir, backupDir, now: at("2026-11-03T10:05:00") });

    const spare = join(root, "spare-data");
    const result = restoreData({ from: backupDir, dataDir: spare });

    // 最新のスナップショット（注文 3 件）が使われる
    expect(result.snapshotDir).toBe(join(backupDir, "snapshots", "20261103-100500"));
    expect(countOrders(databasePath(spare))).toBe(3);
    expect(readFileSync(join(imagesDir(spare), "a.png"), "utf8")).toBe("image-a");

    // 復旧した DB は、そのまま開いて使える
    const restored = open(databasePath(spare));
    expect(() => placeOrder(restored)).not.toThrow();
  });

  test("スナップショットのフォルダを直接指定すると、その時点に戻せる", () => {
    const db = openWithBusinessDay(databasePath(dataDir));
    placeOrder(db);
    const first = backupData({ dataDir, backupDir, now: at("2026-11-03T10:00:00") });
    placeOrder(db);
    backupData({ dataDir, backupDir, now: at("2026-11-03T10:05:00") });

    const spare = join(root, "spare-data");
    restoreData({ from: first.snapshotDir, dataDir: spare });
    expect(countOrders(databasePath(spare))).toBe(1);
  });

  test("復旧先に DB があるときは、指定がなければ止まり、指定すれば退避してから置き換える", () => {
    const db = openWithBusinessDay(databasePath(dataDir));
    placeOrder(db);
    backupData({ dataDir, backupDir, now: at("2026-11-03T10:00:00") });
    placeOrder(db);
    db.close();
    opened.splice(0);

    expect(() => restoreData({ from: backupDir, dataDir })).toThrow("すでにあります");
    // 失敗したときは、今の DB に触れていない
    expect(countOrders(databasePath(dataDir))).toBe(2);

    // 古い DB の WAL が残っていると、復旧した DB と食い違うので、WAL も一緒に退避する
    writeFileSync(`${databasePath(dataDir)}-wal`, "古い WAL");
    const result = restoreData({
      from: backupDir,
      dataDir,
      force: true,
      now: at("2026-11-03T11:00:00"),
    });

    expect(countOrders(databasePath(dataDir))).toBe(1);
    expect(existsSync(`${databasePath(dataDir)}-wal`)).toBe(false);
    expect(result.movedAside).toBe(join(dataDir, "before-restore-20261103-110000"));
    expect(existsSync(join(result.movedAside ?? "", "app.db"))).toBe(true);
    expect(existsSync(join(result.movedAside ?? "", "app.db-wal"))).toBe(true);
  });

  test("バックアップがないとき、壊れたスナップショットのときは、復旧しない", () => {
    expect(() => restoreData({ from: backupDir, dataDir })).toThrow("見つかりません");

    const broken = join(backupDir, "snapshots", "20261103-100000");
    mkdirSync(broken, { recursive: true });
    writeFileSync(join(broken, "app.db"), "壊れたファイル".repeat(200));
    expect(() => restoreData({ from: backupDir, dataDir })).toThrow();
    expect(existsSync(databasePath(dataDir))).toBe(false);
  });
});
