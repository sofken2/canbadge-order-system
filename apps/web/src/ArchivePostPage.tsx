import { badgeSpec } from "@canbadge/badge-spec";
import { BadgeEditor, type BadgeEditorExport, clearDraft, OutputPreview } from "@canbadge/editor";
import { BackButton, Button, Notice, navigate, useAction } from "@canbadge/ui";
import { useEffect, useRef, useState } from "react";
import { api } from "./api";
import "./archive.css";
import "./tryon.css";
import { ArchivePostFields } from "./ArchivePostFields";
import {
  canPost,
  emptyPostForm,
  type PostFormState,
  postFormProblem,
  toPostRequest,
} from "./archive-post-logic";

/** 作りかけのデザインの、ブラウザ内の保存名。注文の作りかけとは、別にする */
const DRAFT_KEY = "archive-post-design";

type Design = BadgeEditorExport & { previewUrl: string };

/**
 * 作品だけを投稿する（W06）。デザイン（エディタ）→ 表示名と同意 → 投稿。
 * 注文はしない。投稿した作品は、審査待ちになり、スタッフが確認して、公開する
 */
export function ArchivePostPage() {
  const [design, setDesign] = useState<Design | undefined>(undefined);
  const [step, setStep] = useState<"design" | "post">("design");
  const [form, setForm] = useState<PostFormState>(emptyPostForm);

  useEffect(() => {
    return () => {
      if (design) URL.revokeObjectURL(design.previewUrl);
    };
  }, [design]);

  const submitting = useRef(false);
  const submit = useAction(async () => {
    // 二度押しで、同じ作品が、2 回投稿されないようにする
    if (submitting.current) return;
    submitting.current = true;
    try {
      if (!design) throw new Error("デザインを決めてください");
      const file = new File([design.png], "badge.png", { type: "image/png" });
      const { imageId } = await api.uploadImage(file);
      await api.call("createArchiveEntry", {
        body: { imageId, editorData: design.editorData, ...toPostRequest(form) },
      });
      await clearDraft(DRAFT_KEY);
      // 投稿のあとは、はじめの画面へ。受け付けたことは、そこで短く知らせる（?posted=1。HomePage）
      navigate("/?posted=1");
      window.scrollTo({ top: 0 });
    } finally {
      submitting.current = false;
    }
  });

  const handleExport = (output: BadgeEditorExport) => {
    setDesign({ ...output, previewUrl: URL.createObjectURL(output.png) });
    setStep("post");
    window.scrollTo({ top: 0 });
  };

  const problem = postFormProblem(form);

  const backToDesign = () => {
    submit.clearError();
    setStep("design");
    window.scrollTo({ top: 0 });
  };

  return (
    // デザインの段は、PC で左にキャンバス、右に操作を並べる（tryon.css の .cb-editpage。注文画面と同じ並び）
    <main className={step === "design" ? "cb-page cb-editpage" : "cb-page"}>
      {/* 確認の段では、デザインの段へ戻る。デザインの段では、みんなの作品へ戻る */}
      <BackButton
        className="cb-back--page"
        disabled={submit.running}
        onClick={() => (step === "post" ? backToDesign() : navigate("/archive"))}
      />
      <h1>作品を投稿する</h1>
      <p className="cb-muted">
        注文はしません。作った作品を、みんなの作品として、見てもらうための投稿です。
      </p>

      {/* 投稿の確認の間も、エディタは、つないだまま隠す（戻ったとき、デザインが消えないように） */}
      <div hidden={step !== "design"}>
        <BadgeEditor
          spec={badgeSpec}
          draftKey={DRAFT_KEY}
          confirmLabel="投稿の確認へ進む"
          onExport={handleExport}
        />
      </div>

      {step === "post" && design && (
        <section aria-label="投稿の確認">
          <h2>投稿の確認</h2>
          <OutputPreview src={design.previewUrl} spec={badgeSpec} />
          <form
            onSubmit={(event) => {
              event.preventDefault();
              if (canPost(form)) void submit.run();
            }}
          >
            <ArchivePostFields value={form} onChange={setForm} disabled={submit.running} />
            {problem && <p className="cb-muted cb-post__problem">{problem}</p>}
            <Button type="submit" size="large" block disabled={!canPost(form) || submit.running}>
              {submit.running ? "投稿しています…" : "投稿する"}
            </Button>
            {submit.error && <Notice tone="error">{submit.error}</Notice>}
          </form>
          <Button
            variant="line"
            block
            className="cb-post__back"
            disabled={submit.running}
            onClick={backToDesign}
          >
            デザインを編集する
          </Button>
        </section>
      )}
    </main>
  );
}
