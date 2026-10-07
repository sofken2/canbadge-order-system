import { badgeSpec } from "@canbadge/badge-spec";
import { BadgeEditor, type BadgeEditorExport, clearDraft, OutputPreview } from "@canbadge/editor";
import { Button, Notice, navigate, useAction } from "@canbadge/ui";
import { useEffect, useRef, useState } from "react";
import { api } from "./api";
import "./archive.css";
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
      navigate("/archive/mine?posted=1");
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

  return (
    <main className="cb-page">
      <h1>作品を、投稿する</h1>
      <p className="cb-muted">
        注文はしません。作った作品を、みんなの作品として、見てもらうための投稿です。
        <a
          href="/archive/mine"
          onClick={(event) => {
            event.preventDefault();
            navigate("/archive/mine");
          }}
        >
          自分の投稿を見る
        </a>
        。
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
            disabled={submit.running}
            onClick={() => {
              submit.clearError();
              setStep("design");
              window.scrollTo({ top: 0 });
            }}
          >
            デザインに戻る
          </Button>
        </section>
      )}
    </main>
  );
}
