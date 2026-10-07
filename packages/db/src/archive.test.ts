import { describe, expect, test } from "bun:test";
import {
  createArchiveEntry,
  createReport,
  getArchiveItem,
  getReportItem,
  listArchiveByAuthor,
  listPublicArchive,
  listReports,
  listStaffArchive,
  MAX_PENDING_ENTRIES_PER_AUTHOR,
  resolveReport,
  transitionArchiveEntry,
} from "./archive";
import { listAuditLogsSince } from "./audit";
import type { Database } from "./connection";
import { DbError } from "./errors";
import { listImagePathsInUse } from "./images";
import { createOrder } from "./orders";
import { getOrder } from "./queries";
import { setAcceptance } from "./settings";
import { payOrder, setup, uniqueToken } from "./test-helpers";

const consent = { selfMade: true, allowOthersToOrder: true } as const;

function codeOf(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (error) {
    if (error instanceof DbError) return error.code;
    throw error;
  }
  return undefined;
}

function post(db: Database, token = uniqueToken(), name = "たろう", imagePath = "images/a.png") {
  return createArchiveEntry(db, {
    imagePath,
    editorData: { version: 1 },
    displayName: name,
    consent,
    authorAnonToken: token,
  });
}

/** 投稿して、承認して、公開中にする */
function publish(db: Database, token = uniqueToken(), imagePath = "images/a.png") {
  const { entry } = post(db, token, "たろう", imagePath);
  transitionArchiveEntry(db, { entryId: entry.id, to: "public", actor: "staff" });
  return { entryId: entry.id, token };
}

/** 作品をコピーして注文する（支払い前） */
function orderFrom(db: Database, entryId: string, imagePath = "images/a.png") {
  return createOrder(db, {
    imagePath,
    editorData: { version: 1 },
    quantity: 1,
    anonToken: uniqueToken(),
    sourceArchiveEntryId: entryId,
  });
}

describe("投稿", () => {
  test("審査待ちで作られる。同意の内容と、日時（操作の時刻）が記録される", () => {
    const { db, clock } = setup();
    const { entry, design } = post(db, "t".repeat(32), "はなこ");
    expect(entry.status).toBe("pending_review");
    expect(entry.displayName).toBe("はなこ");
    expect(entry.consent).toEqual({
      selfMade: true,
      allowOthersToOrder: true,
      agreedAt: clock.now().toISOString(),
    });
    expect(entry.authorAnonToken).toBe("t".repeat(32));
    // デザインも作られ、元作品への参照は持たない
    expect(design.imagePath).toBe("images/a.png");
    expect(design.sourceArchiveEntryId).toBeUndefined();
  });

  test("同意が欠けている・false なら、投稿できない（API を通さなくても、db が保証する）", () => {
    const { db } = setup();
    const base = {
      imagePath: "images/a.png",
      editorData: { version: 1 },
      displayName: "たろう",
      authorAnonToken: uniqueToken(),
    };
    for (const bad of [
      { selfMade: false, allowOthersToOrder: true },
      { selfMade: true, allowOthersToOrder: false },
      { selfMade: true },
      {},
    ]) {
      expect(codeOf(() => createArchiveEntry(db, { ...base, consent: bad as never }))).toBe(
        "VALIDATION_FAILED",
      );
    }
    expect(listStaffArchive(db, { limit: 10 }).items).toHaveLength(0);
  });

  test("表示名が空・長すぎるなら、断る。前後の空白は取る", () => {
    const { db } = setup();
    expect(codeOf(() => post(db, uniqueToken(), "   "))).toBe("VALIDATION_FAILED");
    expect(codeOf(() => post(db, uniqueToken(), "あ".repeat(21)))).toBe("VALIDATION_FAILED");
    expect(post(db, uniqueToken(), "  たろう  ").entry.displayName).toBe("たろう");
  });

  test("画像のパスが、データ置き場の外を指すなら、断る", () => {
    const { db } = setup();
    expect(codeOf(() => post(db, uniqueToken(), "たろう", "../../secret.png"))).toBe(
      "VALIDATION_FAILED",
    );
  });

  test("1 端末が、同時に持てる審査待ちは 3 件まで。審査が済めば、また投稿できる。別の端末には、影響しない", () => {
    const { db } = setup();
    const token = uniqueToken();
    const ids = Array.from(
      { length: MAX_PENDING_ENTRIES_PER_AUTHOR },
      () => post(db, token).entry.id,
    );
    expect(codeOf(() => post(db, token))).toBe("RATE_LIMITED");
    expect(() => post(db, uniqueToken())).not.toThrow();

    transitionArchiveEntry(db, { entryId: ids[0] ?? "", to: "rejected", actor: "staff" });
    expect(() => post(db, token)).not.toThrow();
  });

  test("操作ログに残る", () => {
    const { db } = setup();
    const { entry } = post(db);
    const logs = listAuditLogsSince(db, 0, 100).map((r) => r.log);
    expect(logs.some((l) => l.action === "archive.create" && l.targetId === entry.id)).toBe(true);
  });
});

describe("審査（状態の遷移）", () => {
  test("承認すると公開中、却下すると却下。審査した日時が入る", () => {
    const { db, clock } = setup();
    const a = post(db).entry;
    const b = post(db).entry;
    clock.advance(60_000);
    const approved = transitionArchiveEntry(db, { entryId: a.id, to: "public", actor: "staff" });
    const rejected = transitionArchiveEntry(db, { entryId: b.id, to: "rejected", actor: "staff" });
    expect(approved.entry.status).toBe("public");
    expect(approved.entry.reviewedAt).toBe(clock.now().toISOString());
    expect(rejected.entry.status).toBe("rejected");
  });

  test("遷移表にない遷移・その役割にできない遷移は、断る", () => {
    const { db } = setup();
    const a = post(db).entry;
    // 審査待ちを、いきなり非公開にはできない
    expect(
      codeOf(() => transitionArchiveEntry(db, { entryId: a.id, to: "hidden", actor: "staff" })),
    ).toBe("INVALID_TRANSITION");
    // 来場者は、承認できない
    expect(
      codeOf(() =>
        transitionArchiveEntry(db, {
          entryId: a.id,
          to: "public",
          actor: "visitor",
          anonToken: a.authorAnonToken,
        }),
      ),
    ).toBe("INVALID_TRANSITION");
    // 却下のあとに、承認はできない
    transitionArchiveEntry(db, { entryId: a.id, to: "rejected", actor: "staff" });
    expect(
      codeOf(() => transitionArchiveEntry(db, { entryId: a.id, to: "public", actor: "staff" })),
    ).toBe("INVALID_TRANSITION");
  });

  test("作者は、自分の公開中の作品を取り下げられる。審査した日時は、変わらない", () => {
    const { db, clock } = setup();
    const { entryId, token } = publish(db);
    const reviewedAt = getArchiveItem(db, entryId)?.entry.reviewedAt;
    clock.advance(60_000);
    const hidden = transitionArchiveEntry(db, {
      entryId,
      to: "hidden",
      actor: "visitor",
      anonToken: token,
    });
    expect(hidden.entry.status).toBe("hidden");
    expect(hidden.entry.reviewedAt).toBe(reviewedAt);
  });

  test("作者以外は、取り下げられない。作品があることも、教えない（NOT_FOUND）", () => {
    const { db } = setup();
    const { entryId } = publish(db);
    expect(
      codeOf(() =>
        transitionArchiveEntry(db, {
          entryId,
          to: "hidden",
          actor: "visitor",
          anonToken: uniqueToken(),
        }),
      ),
    ).toBe("NOT_FOUND");
    expect(
      codeOf(() => transitionArchiveEntry(db, { entryId, to: "hidden", actor: "visitor" })),
    ).toBe("NOT_FOUND");
    expect(getArchiveItem(db, entryId)?.entry.status).toBe("public");
  });

  test("存在しない作品は、NOT_FOUND", () => {
    const { db } = setup();
    expect(
      codeOf(() =>
        transitionArchiveEntry(db, {
          entryId: "01HZX3V5Q8N4M6T2B9C7D1E0FA",
          to: "public",
          actor: "staff",
        }),
      ),
    ).toBe("NOT_FOUND");
  });

  test("遷移は、操作ログに、元の状態と先の状態とともに残る", () => {
    const { db } = setup();
    const { entry } = post(db);
    transitionArchiveEntry(db, { entryId: entry.id, to: "public", actor: "staff" });
    const log = listAuditLogsSince(db, 0, 100)
      .map((r) => r.log)
      .find((l) => l.action === "archive.transition" && l.targetId === entry.id);
    expect(log?.actor).toBe("staff");
    expect(log?.detail).toMatchObject({ from: "pending_review", to: "public" });
  });
});

describe("非公開にしたとき：コピーの、支払い前の注文を止める", () => {
  test("その作品から作った、支払い前（submitted）の注文だけが失効する。支払い済み・別の作品のコピーは、そのまま", () => {
    const { db } = setup();
    const target = publish(db);
    const other = publish(db);

    const waiting = orderFrom(db, target.entryId).order;
    const paid = orderFrom(db, target.entryId).order;
    payOrder(db, paid.id);
    const ofOther = orderFrom(db, other.entryId).order;

    transitionArchiveEntry(db, { entryId: target.entryId, to: "hidden", actor: "staff" });

    expect(getOrder(db.orm, waiting.id)?.status).toBe("expired");
    expect(getOrder(db.orm, paid.id)?.status).toBe("paid");
    expect(getOrder(db.orm, ofOther.id)?.status).toBe("submitted");
  });

  test("作者の取り下げでも、同じように止まる。理由が、操作ログに残る", () => {
    const { db } = setup();
    const { entryId, token } = publish(db);
    const waiting = orderFrom(db, entryId).order;
    transitionArchiveEntry(db, { entryId, to: "hidden", actor: "visitor", anonToken: token });
    expect(getOrder(db.orm, waiting.id)?.status).toBe("expired");

    const log = listAuditLogsSince(db, 0, 100)
      .map((r) => r.log)
      .find(
        (l) => l.targetType === "order" && l.targetId === waiting.id && l.detail?.to === "expired",
      );
    expect(log?.actor).toBe("system");
    expect(log?.detail).toMatchObject({ reason: "archive_hidden", archiveEntryId: entryId });
  });

  test("止める処理は、非公開にする遷移と、同じトランザクション（途中で失敗すれば、すべて取り消される）", () => {
    const { db } = setup();
    const { entryId } = publish(db);
    const waiting = orderFrom(db, entryId).order;
    // 失効の更新を、わざと失敗させる（DB のトリガー）。非公開にする更新は、その前に済んでいる
    db.sqlite.run(
      "CREATE TRIGGER fail_expire BEFORE UPDATE ON orders WHEN NEW.status = 'expired' BEGIN SELECT RAISE(ABORT, 'わざと失敗'); END",
    );
    expect(() => transitionArchiveEntry(db, { entryId, to: "hidden", actor: "staff" })).toThrow();
    db.sqlite.run("DROP TRIGGER fail_expire");
    expect(getOrder(db.orm, waiting.id)?.status).toBe("submitted");
    // 作品は、公開中のまま（非公開にだけ、なってしまわない）
    expect(getArchiveItem(db, entryId)?.entry.status).toBe("public");
  });

  test("非公開にしたとき、その作品への未対応の通報は、対応済みになる", () => {
    const { db } = setup();
    const { entryId } = publish(db);
    const report = createReport(db, { entryId, reason: "他人のキャラクターです" });
    transitionArchiveEntry(db, { entryId, to: "hidden", actor: "staff" });
    expect(getReportItem(db, report.id)?.report.status).toBe("resolved");
    expect(getReportItem(db, report.id)?.report.resolvedAt).toBeDefined();
  });
});

describe("作品からの注文", () => {
  test("公開中の作品は、コピーして注文できる。元作品への参照が、新しいデザインに残る", () => {
    const { db } = setup();
    const { entryId } = publish(db);
    const created = orderFrom(db, entryId);
    expect(created.design.sourceArchiveEntryId).toBe(entryId);
    // 元の作品のデザインとは、別のデザイン
    expect(created.design.id).not.toBe(getArchiveItem(db, entryId)?.design.id);
  });

  test("公開中でない作品（審査待ち・却下・非公開）・存在しない作品からは、注文できない（注文は作られない）", () => {
    const { db } = setup();
    const pending = post(db).entry.id;
    const rejected = post(db).entry.id;
    transitionArchiveEntry(db, { entryId: rejected, to: "rejected", actor: "staff" });
    const hidden = publish(db).entryId;
    transitionArchiveEntry(db, { entryId: hidden, to: "hidden", actor: "staff" });

    for (const entryId of [pending, rejected, hidden, "01HZX3V5Q8N4M6T2B9C7D1E0FA"]) {
      expect(codeOf(() => orderFrom(db, entryId))).toBe("NOT_FOUND");
    }
    const count = db.sqlite.query("SELECT count(*) AS n FROM orders").get() as { n: number };
    expect(count.n).toBe(0);
  });

  test("受付が止まっているときは、作品からも注文できない", () => {
    const { db } = setup();
    const { entryId } = publish(db);
    setAcceptance(db, { acceptance: "busy", actor: "staff" });
    expect(codeOf(() => orderFrom(db, entryId))).toBe("NOT_ACCEPTING");
  });
});

describe("通報", () => {
  test("公開中の作品を通報できる。理由が前後の空白を取って記録され、未対応で作られる", () => {
    const { db } = setup();
    const { entryId } = publish(db);
    const report = createReport(db, { entryId, reason: "  他人の写真です  " });
    expect(report.status).toBe("open");
    expect(report.reason).toBe("他人の写真です");
    expect(report.archiveEntryId).toBe(entryId);
  });

  test("公開中でない作品・存在しない作品は、通報できない。理由が空・長すぎるなら、断る", () => {
    const { db } = setup();
    const pending = post(db).entry.id;
    const { entryId } = publish(db);
    expect(codeOf(() => createReport(db, { entryId: pending, reason: "x" }))).toBe("NOT_FOUND");
    expect(
      codeOf(() => createReport(db, { entryId: "01HZX3V5Q8N4M6T2B9C7D1E0FA", reason: "x" })),
    ).toBe("NOT_FOUND");
    expect(codeOf(() => createReport(db, { entryId, reason: "  " }))).toBe("VALIDATION_FAILED");
    expect(codeOf(() => createReport(db, { entryId, reason: "あ".repeat(501) }))).toBe(
      "VALIDATION_FAILED",
    );
  });

  test("スタッフが、対応済みにする。もう一度は、できない", () => {
    const { db, clock } = setup();
    const { entryId } = publish(db);
    const report = createReport(db, { entryId, reason: "x" });
    clock.advance(1000);
    const resolved = resolveReport(db, { reportId: report.id });
    expect(resolved.status).toBe("resolved");
    expect(resolved.resolvedAt).toBe(clock.now().toISOString());
    expect(codeOf(() => resolveReport(db, { reportId: report.id }))).toBe("INVALID_TRANSITION");
    expect(codeOf(() => resolveReport(db, { reportId: "01HZX3V5Q8N4M6T2B9C7D1E0FA" }))).toBe(
      "NOT_FOUND",
    );
  });
});

describe("一覧", () => {
  test("公開の一覧は、公開中だけを、新しい順に出す。続きは before で取る", () => {
    const { db, clock } = setup();
    const ids: string[] = [];
    for (let i = 0; i < 5; i++) {
      clock.advance(1000);
      ids.push(publish(db).entryId);
    }
    post(db); // 審査待ちは、出ない
    const hidden = publish(db).entryId;
    transitionArchiveEntry(db, { entryId: hidden, to: "hidden", actor: "staff" });

    const first = listPublicArchive(db, { limit: 3 });
    expect(first.items.map((i) => i.entry.id)).toEqual(ids.slice(2).reverse());
    expect(first.nextBefore).toBe(ids[2] ?? null);
    const second = listPublicArchive(db, { limit: 3, before: first.nextBefore ?? undefined });
    expect(second.items.map((i) => i.entry.id)).toEqual(ids.slice(0, 2).reverse());
    expect(second.nextBefore).toBeNull();
  });

  test("自分の作品の一覧は、どの状態でも出る。他人の作品は、出ない", () => {
    const { db } = setup();
    const mine = uniqueToken();
    const a = post(db, mine).entry.id;
    const b = post(db, mine).entry.id;
    transitionArchiveEntry(db, { entryId: b, to: "rejected", actor: "staff" });
    post(db, uniqueToken());
    const list = listArchiveByAuthor(db, mine);
    expect(list.map((i) => [i.entry.id, i.entry.status])).toEqual([
      [b, "rejected"],
      [a, "pending_review"],
    ]);
  });

  test("審査の一覧は、状態で絞れ、未対応の通報の件数がつく", () => {
    const { db } = setup();
    const pending = post(db).entry.id;
    const reported = publish(db).entryId;
    createReport(db, { entryId: reported, reason: "a" });
    createReport(db, { entryId: reported, reason: "b" });
    const done = createReport(db, { entryId: reported, reason: "c" });
    resolveReport(db, { reportId: done.id });

    const all = listStaffArchive(db, { limit: 10 }).items;
    expect(all.find((i) => i.entry.id === reported)?.openReportCount).toBe(2);
    expect(all.find((i) => i.entry.id === pending)?.openReportCount).toBe(0);
    expect(
      listStaffArchive(db, { status: "pending_review", limit: 10 }).items.map((i) => i.entry.id),
    ).toEqual([pending]);
  });

  test("通報の一覧は、状態で絞れ、通報された作品がつく", () => {
    const { db } = setup();
    const { entryId } = publish(db);
    const r1 = createReport(db, { entryId, reason: "a" });
    const r2 = createReport(db, { entryId, reason: "b" });
    resolveReport(db, { reportId: r1.id });
    expect(listReports(db, { limit: 10 }).items.map((i) => i.report.id)).toEqual([r2.id, r1.id]);
    const open = listReports(db, { status: "open", limit: 10 }).items;
    expect(open.map((i) => i.report.id)).toEqual([r2.id]);
    expect(open[0]?.entry.id).toBe(entryId);
    expect(open[0]?.design.imagePath).toBe("images/a.png");
  });
});

describe("画像を、消してよいか（A02 の掃除との連動）", () => {
  test("審査待ち・公開中の作品の画像は、使っている。却下・非公開になった作品の画像は、使わない", () => {
    const { db } = setup();
    const pending = post(db, uniqueToken(), "a", "images/pending.png").entry.id;
    const pub = publish(db, uniqueToken(), "images/public.png").entryId;
    const rej = post(db, uniqueToken(), "a", "images/rejected.png").entry.id;
    transitionArchiveEntry(db, { entryId: rej, to: "rejected", actor: "staff" });
    const hid = publish(db, uniqueToken(), "images/hidden.png").entryId;
    transitionArchiveEntry(db, { entryId: hid, to: "hidden", actor: "staff" });

    const inUse = listImagePathsInUse(db);
    expect(inUse.has("images/pending.png")).toBe(true);
    expect(inUse.has("images/public.png")).toBe(true);
    expect(inUse.has("images/rejected.png")).toBe(false);
    expect(inUse.has("images/hidden.png")).toBe(false);
    expect([pending, pub].length).toBe(2);
  });

  test("非公開になっても、コピーの注文が生きている間は、同じ画像を使っている。失効すれば、使わない", () => {
    const { db } = setup();
    const { entryId } = publish(db, uniqueToken(), "images/shared.png");
    const paid = orderFrom(db, entryId, "images/shared.png").order;
    payOrder(db, paid.id);
    transitionArchiveEntry(db, { entryId, to: "hidden", actor: "staff" });
    expect(listImagePathsInUse(db).has("images/shared.png")).toBe(true);

    // 受付終了で、支払い待ちが失効する。支払い済みは、残る
    setAcceptance(db, { acceptance: "closed", actor: "staff" });
    expect(listImagePathsInUse(db).has("images/shared.png")).toBe(true);
  });
});
