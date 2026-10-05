import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  checkPrintSheet,
  createManualClock,
  createOrder,
  createPrintSheet,
  databasePath,
  getOrder,
  imagesDir,
  newId,
  openBusinessDay,
  openDatabase,
  schema,
  setAcceptance,
  sheetsDir,
  transitionOrder,
  write,
  writeAudit,
} from "@canbadge/db";
import type { OrderStatus } from "@canbadge/shared";
import { renderSampleImage, sampleImageFile, sampleImageNames } from "./sample-images";
import { renderSamplePdf } from "./sample-pdf";

/** サンプルデータを作ったことの印。db:reset が、サンプル以外のデータを消さないための目印にする */
export const SEED_MARKER_ACTION = "fixtures.seed";

/** 操作の時刻を、現在から何分前までにさかのぼって並べるか。シナリオの合計がこの分数に収まること */
const PLAN_MINUTES = 90;

const sheetFiles = [
  "sample-sheet-1.pdf",
  "sample-sheet-2.pdf",
  "sample-sheet-3.pdf",
  "sample-sheet-4.pdf",
];

export type SeedOptions = {
  /** データ置き場。この中に DB・画像・PDF を作る */
  dataDir: string;
  /** 「いま」の時刻。サンプルの操作は、この時刻の PLAN_MINUTES 分前から並べる（テストで固定できる） */
  now?: Date;
};

export type SeedSummary = {
  businessDate: string;
  /** サンプルの注文。キーはシナリオ上の名前 */
  orders: Record<string, { orderId: string; orderNumber: number; status: OrderStatus }>;
  sheets: number;
  archiveEntries: number;
};

/** サンプル画像と PDF のファイルを、データ置き場に書き出す */
export function writeSampleFiles(dataDir: string): void {
  mkdirSync(imagesDir(dataDir), { recursive: true });
  mkdirSync(sheetsDir(dataDir), { recursive: true });
  for (const name of sampleImageNames) {
    writeFileSync(join(imagesDir(dataDir), sampleImageFile(name)), renderSampleImage(name));
  }
  for (const file of sheetFiles) {
    writeFileSync(join(sheetsDir(dataDir), file), renderSamplePdf(file));
  }
}

/** 匿名トークン（16 文字以上）。注文ごとに別の来場者として扱う */
const visitorToken = (n: number): string =>
  `sample-visitor-${String(n).padStart(3, "0")}`.padEnd(32, "-");

/**
 * サンプルデータを作る。**すべての状態の注文・明細・印刷シート・アーカイブ作品**がそろう。
 * 状態は、本物と同じ db の遷移関数を通して作る（操作ログも本物と同じ形で残る）。
 * 時刻は、いまの PLAN_MINUTES 分前から進めるので、営業日は今日、完成の時刻は少し前になる
 */
export function seedSampleData(options: SeedOptions): SeedSummary {
  const now = options.now ?? new Date();
  const clock = createManualClock(new Date(now.getTime() - PLAN_MINUTES * 60_000).toISOString());
  writeSampleFiles(options.dataDir);

  const db = openDatabase({ path: databasePath(options.dataDir), now: clock.now });
  try {
    const step = (minutes: number) => clock.advance(minutes * 60_000);
    const orders: Record<string, { orderId: string; itemId: string; orderNumber: number }> = {};
    let created = 0;

    const make = (name: string, input: { token?: string; sourceArchiveEntryId?: string } = {}) => {
      const image = sampleImageNames[created % sampleImageNames.length] ?? "rings";
      created += 1;
      const { order, items } = createOrder(db, {
        imagePath: `images/${sampleImageFile(image)}`,
        editorData: { version: 1, sample: image },
        quantity: 1,
        anonToken: input.token ?? visitorToken(created),
        ...(input.sourceArchiveEntryId ? { sourceArchiveEntryId: input.sourceArchiveEntryId } : {}),
      });
      const item = items[0];
      if (!item) throw new Error("明細が作られませんでした");
      orders[name] = { orderId: order.id, itemId: item.id, orderNumber: order.orderNumber };
      step(1);
    };
    const id = (name: string): string => orders[name]?.orderId ?? "";
    const itemId = (name: string): string => orders[name]?.itemId ?? "";
    const move = (name: string, to: OrderStatus, actor: "staff" | "visitor" = "staff") => {
      transitionOrder(db, { orderId: id(name), to, actor });
      step(1);
    };
    const pay = (name: string) => move(name, "paid");
    const printSheet = (file: string, names: string[]) =>
      createPrintSheet(db, { pdfPath: `sheets/${file}`, orderItemIds: names.map(itemId) }).sheet;
    const check = (sheetId: string, reprint: string[] = []) => {
      checkPrintSheet(db, { sheetId, reprintOrderItemIds: reprint.map(itemId), actor: "staff" });
      step(2);
    };

    openBusinessDay(db, { actor: "staff" });
    step(1);

    // 失効：受付終了で、支払い待ちの注文が失効する（そのあと受付を再開する）
    make("expired");
    setAcceptance(db, { acceptance: "closed", actor: "staff" });
    step(1);
    setAcceptance(db, { acceptance: "open", actor: "staff" });
    step(1);

    // 取り消し（来場者）と、返金
    make("cancelled");
    move("cancelled", "cancelled", "visitor");
    make("refunded");
    pay("refunded");
    move("refunded", "refunded");

    // 1 枚目のシート：5 個とも OK。そこから、組み立て・完成・受け渡しまで進める
    for (const name of ["pickedUp", "readyLong", "readyNew", "assembling", "printedA"]) {
      make(name);
      pay(name);
    }
    check(
      printSheet("sample-sheet-1.pdf", [
        "pickedUp",
        "readyLong",
        "readyNew",
        "assembling",
        "printedA",
      ]).id,
    );

    move("pickedUp", "assembling");
    move("pickedUp", "ready");
    move("pickedUp", "picked_up");
    move("readyLong", "assembling");
    move("readyLong", "ready");
    // 完成してから時間がたって、まだ受け取られていない注文（長時間未受け取りの強調表示の確認用）
    step(25);
    move("readyNew", "assembling");
    move("readyNew", "ready");
    move("assembling", "assembling");

    // 2 枚目のシート：1 個だけ再印刷。OK の注文は印刷済みになり、再印刷の注文は印刷待ちのまま
    for (const name of ["printedB", "reprintPrinting", "printedC"]) {
      make(name);
      pay(name);
    }
    const second = printSheet("sample-sheet-2.pdf", ["printedB", "reprintPrinting", "printedC"]);
    check(second.id, ["reprintPrinting"]);

    // 3 枚目のシート：2 個とも再印刷（用紙ごとやり直し）で、失敗になる
    for (const name of ["failedPrinting", "failedWaiting"]) {
      make(name);
      pay(name);
    }
    const third = printSheet("sample-sheet-3.pdf", ["failedPrinting", "failedWaiting"]);
    check(third.id, ["failedPrinting", "failedWaiting"]);

    // 4 枚目のシート：再印刷のバッジ 2 個を載せ直した、印刷中のシート（確認待ち）
    printSheet("sample-sheet-4.pdf", ["reprintPrinting", "failedPrinting"]);
    step(1);

    // 印刷待ちのまま（まだシートに載っていない）注文
    make("queued");
    pay("queued");

    // アーカイブ作品（優先度低）。注文の遷移と違い、状態を変える関数はまだないので、最終の状態で直接作る
    const archive = seedArchive(db, clock.now());
    step(1);

    // 支払い待ち。片方はアーカイブ作品をコピーした注文、もう片方は同じ来場者の 2 件目
    make("waiting", { token: visitorToken(90) });
    make("waitingFromArchive", {
      token: visitorToken(90),
      ...(archive.publicEntryId ? { sourceArchiveEntryId: archive.publicEntryId } : {}),
    });

    if (clock.now().getTime() > now.getTime()) {
      throw new Error(
        "サンプルデータの時刻が現在を超えました。seed.ts の PLAN_MINUTES を大きくしてください",
      );
    }

    write(db, (ctx) =>
      writeAudit(ctx, {
        actor: "system",
        action: SEED_MARKER_ACTION,
        targetType: "setting",
        targetId: "1",
        detail: { orders: created },
      }),
    );

    const summary: SeedSummary = {
      businessDate: "",
      orders: {},
      sheets: sheetFiles.length,
      archiveEntries: archive.count,
    };
    for (const [name, o] of Object.entries(orders)) {
      const order = getOrder(db.orm, o.orderId);
      if (!order) throw new Error(`注文が見つかりません: ${name}`);
      summary.businessDate = order.businessDate;
      summary.orders[name] = {
        orderId: o.orderId,
        orderNumber: o.orderNumber,
        status: order.status,
      };
    }
    return summary;
  } finally {
    db.close();
  }
}

/** アーカイブ作品を、公開中・審査待ち・却下・非公開の各状態で作る。通報も、未対応と対応済みを 1 件ずつ */
function seedArchive(
  db: ReturnType<typeof openDatabase>,
  at: Date,
): { count: number; publicEntryId: string | undefined } {
  const iso = at.toISOString();
  const entries = [
    { name: "rings", displayName: "たつ", status: "public" },
    { name: "smiley", displayName: "ゆうこ", status: "public" },
    { name: "dots", displayName: "さくら", status: "pending_review" },
    { name: "checker", displayName: "けん", status: "rejected" },
    { name: "sunrise", displayName: "みどり", status: "hidden" },
  ] as const;

  const ids: string[] = [];
  entries.forEach((entry, index) => {
    const designId = newId(at);
    const entryId = newId(at);
    ids.push(entryId);
    db.orm
      .insert(schema.designs)
      .values({
        id: designId,
        imagePath: `images/${sampleImageFile(entry.name)}`,
        editorData: { version: 1, sample: entry.name },
        createdAt: iso,
      })
      .run();
    db.orm
      .insert(schema.archiveEntries)
      .values({
        id: entryId,
        designId,
        displayName: entry.displayName,
        status: entry.status,
        consent: { selfMade: true, allowOthersToOrder: true, agreedAt: iso },
        authorAnonToken: visitorToken(100 + index),
        createdAt: iso,
        reviewedAt: entry.status === "pending_review" ? null : iso,
      })
      .run();
  });

  const [firstPublic, , , , hidden] = ids;
  if (firstPublic) {
    db.orm
      .insert(schema.reports)
      .values({
        id: newId(at),
        archiveEntryId: firstPublic,
        reason: "他の作品に似ています",
        status: "open",
        createdAt: iso,
      })
      .run();
  }
  if (hidden) {
    db.orm
      .insert(schema.reports)
      .values({
        id: newId(at),
        archiveEntryId: hidden,
        reason: "キャラクターの絵が含まれています",
        status: "resolved",
        createdAt: iso,
        resolvedAt: iso,
      })
      .run();
  }
  return { count: entries.length, publicEntryId: firstPublic };
}
