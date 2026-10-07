import { describe, expect, test } from "bun:test";
import { createArchiveEntryRequestSchema } from "@canbadge/shared";
import {
  canPost,
  canWithdraw,
  DISPLAY_NAME_MAX,
  emptyPostForm,
  myEntryStatus,
  type PostFormState,
  postFailedAfterOrderMessage,
  postFormProblem,
  toPostRequest,
  withdrawConfirmMessage,
} from "./archive-post-logic";

const ok: PostFormState = { displayName: "たろう", selfMade: true, allowOthersToOrder: true };
const ID = "01HZX3V5Q8N4M6T2B9C7D1E0FA";

describe("投稿できるか", () => {
  test("表示名と、同意の 2 項目が、そろっているときだけ、投稿できる", () => {
    expect(canPost(ok)).toBe(true);
    expect(postFormProblem(ok)).toBeUndefined();
    expect(canPost(emptyPostForm)).toBe(false);
  });

  test("同意のどちらかが欠けていると、投稿できない（理由が、どの項目かを伝える）", () => {
    expect(canPost({ ...ok, selfMade: false })).toBe(false);
    expect(postFormProblem({ ...ok, selfMade: false })).toContain("自分で作った");
    expect(canPost({ ...ok, allowOthersToOrder: false })).toBe(false);
    expect(postFormProblem({ ...ok, allowOthersToOrder: false })).toContain("注文してもよい");
  });

  test("表示名が、空・空白だけ・長すぎるなら、投稿できない。前後の空白は数えない", () => {
    expect(canPost({ ...ok, displayName: "" })).toBe(false);
    expect(canPost({ ...ok, displayName: "   " })).toBe(false);
    expect(canPost({ ...ok, displayName: "あ".repeat(DISPLAY_NAME_MAX + 1) })).toBe(false);
    expect(canPost({ ...ok, displayName: "あ".repeat(DISPLAY_NAME_MAX) })).toBe(true);
    expect(canPost({ ...ok, displayName: `  ${"あ".repeat(DISPLAY_NAME_MAX)}  ` })).toBe(true);
  });
});

describe("api に渡す形", () => {
  test("前後の空白を取り、同意を true で渡す。契約のスキーマ（api の検証）に通る", () => {
    const request = toPostRequest({ ...ok, displayName: "  たろう  " });
    expect(request).toEqual({
      displayName: "たろう",
      consent: { selfMade: true, allowOthersToOrder: true },
    });
    expect(
      createArchiveEntryRequestSchema.safeParse({
        imageId: ID,
        editorData: { version: 1 },
        ...request,
      }).success,
    ).toBe(true);
  });

  test("投稿できない状態では、作らない（同意が欠けた投稿を、組み立てられない）", () => {
    expect(() => toPostRequest({ ...ok, selfMade: false })).toThrow();
    expect(() => toPostRequest(emptyPostForm)).toThrow();
  });
});

describe("自分の投稿", () => {
  test("4 つの状態に、名前と、来場者への案内がある", () => {
    for (const status of ["pending_review", "public", "rejected", "hidden"] as const) {
      expect(myEntryStatus[status].label.length).toBeGreaterThan(1);
      expect(myEntryStatus[status].note.length).toBeGreaterThan(10);
    }
  });

  test("取り下げられるのは、公開中だけ", () => {
    expect(canWithdraw("public")).toBe(true);
    for (const status of ["pending_review", "rejected", "hidden"] as const) {
      expect(canWithdraw(status)).toBe(false);
    }
  });

  test("取り下げの確認は、何が起きるかを書く（一覧から消える・注文できなくなる・支払い前の注文が止まる）", () => {
    const text = withdrawConfirmMessage("たろう");
    expect(text).toContain("「たろう」");
    expect(text).toContain("注文できなくなります");
    expect(text).toContain("まだ支払っていない人の注文は、止まります");
  });

  test("注文はできたが投稿が失敗したとき、注文が無事なことを、先に伝える", () => {
    const text = postFailedAfterOrderMessage("通信に失敗しました");
    expect(text.startsWith("注文はできました")).toBe(true);
    expect(text).toContain("通信に失敗しました");
  });
});
