import { badgeSpec } from "@canbadge/badge-spec";
import { BadgeEditor, type BadgeEditorExport, clearDraft, OutputPreview } from "@canbadge/editor";
import { acceptanceLabels } from "@canbadge/shared";
import { Button, Checkbox, Notice, navigate, useAction, useResource } from "@canbadge/ui";
import { useEffect, useRef, useState } from "react";
import { api } from "./api";
import { turnstileSiteKey } from "./env";
import { TurnstileWidget } from "./TurnstileWidget";

/** 作りかけのデザインの、ブラウザ内の保存名。注文が済んだら消す */
const DRAFT_KEY = "order-design";

/** 開発（Turnstile のキーなし）のとき、トークンの代わりに送る文字列。サーバー側の検証は A06 */
const DEV_TOKEN = "dev";

type Design = BadgeEditorExport & {
  /** 仕上がりのプレビューに使う、PNG の一時的なアドレス */
  previewUrl: string;
};

/**
 * 注文フロー。デザイン（エディタ）→ 注文の確認 → 確定、を一続きにする。
 * 確認から戻ってもデザインが消えないよう、エディタは、確認の間も、つないだまま隠しておく
 */
export function OrderPage() {
  const status = useResource(() => api.call("getStatus"), { refreshMs: 5000 });
  const [design, setDesign] = useState<Design | undefined>(undefined);
  const [step, setStep] = useState<"design" | "confirm">("design");
  const [quantity, setQuantity] = useState(1);
  const [consent, setConsent] = useState(false);
  const [token, setToken] = useState<string | undefined>(undefined);
  /** 注文を試すたびに増やす。Turnstile のトークンは 1 回しか使えないので、作り直す */
  const [tokenVersion, setTokenVersion] = useState(0);

  // 仕上がりのプレビューの一時アドレスは、作り直すとき・画面を閉じるときに解放する
  useEffect(() => {
    return () => {
      if (design) URL.revokeObjectURL(design.previewUrl);
    };
  }, [design]);

  const submitting = useRef(false);
  /** 画像は、同じ PNG なら、送り直さない（注文だけが失敗して、もう一度押したとき、画像を増やさないため） */
  const uploaded = useRef<{ png: Blob; imageId: string } | undefined>(undefined);

  const submit = useAction(async () => {
    // 二度押しで、注文が重複しないようにする（ボタンを押せなくするのは、画面の反映が遅れるので、これとは別に）
    if (submitting.current) return;
    submitting.current = true;
    try {
      if (!design) throw new Error("デザインを決めてください");
      let imageId = uploaded.current?.png === design.png ? uploaded.current.imageId : undefined;
      if (!imageId) {
        const file = new File([design.png], "badge.png", { type: "image/png" });
        imageId = (await api.uploadImage(file)).imageId;
        uploaded.current = { png: design.png, imageId };
      }
      const { orderId } = await api.call("createOrder", {
        body: {
          imageId,
          editorData: design.editorData,
          quantity,
          turnstileToken: turnstileSiteKey ? (token ?? "") : DEV_TOKEN,
          rightsConsent: true,
        },
      });
      await clearDraft(DRAFT_KEY);
      navigate(`/orders/${orderId}`);
    } catch (error) {
      // 失敗したら、確認をやり直す（使ったトークンは、もう使えない）
      setTokenVersion((version) => version + 1);
      throw error;
    } finally {
      submitting.current = false;
    }
  });

  const setting = status.data;
  const accepting = setting?.acceptance === "open";
  const maxQuantity = setting?.maxQuantityPerOrder ?? 1;
  const needsToken = turnstileSiteKey !== undefined;
  const canSubmit = accepting && consent && (!needsToken || token !== undefined) && !submit.running;

  const handleExport = (output: BadgeEditorExport) => {
    setDesign({ ...output, previewUrl: URL.createObjectURL(output.png) });
    setConsent(false);
    setStep("confirm");
    window.scrollTo({ top: 0 });
  };

  const backToDesign = () => {
    submit.clearError();
    setStep("design");
    window.scrollTo({ top: 0 });
  };

  const total = (setting?.price ?? 0) * quantity;

  return (
    <main className="cb-page">
      <h1>オリジナル缶バッジを、つくろう</h1>
      <p className="cb-muted">
        もう注文した方（スマホを変えた・画面を閉じてしまった方）は、
        <a
          href="/lookup"
          onClick={(event) => {
            event.preventDefault();
            navigate("/lookup");
          }}
        >
          注文番号と確認コードで、注文を開く
        </a>
        。
      </p>
      {status.error && <Notice tone="error">{status.error}</Notice>}
      {setting && (
        <p className="cb-muted">
          受付：{acceptanceLabels[setting.acceptance]} ／ {setting.price}円 / 1個 ／ いま
          {setting.waitingCount}件待ち
        </p>
      )}
      <p className="cb-stepper" aria-live="polite">
        <span aria-current={step === "design" ? "step" : undefined}>1 デザイン</span>
        <span aria-hidden="true">→</span>
        <span aria-current={step === "confirm" ? "step" : undefined}>2 注文の確認</span>
      </p>

      {/* 確認の間も、エディタはつないだまま隠す（戻ったとき、デザインが消えないように） */}
      <div hidden={step !== "design"}>
        <BadgeEditor
          spec={badgeSpec}
          draftKey={DRAFT_KEY}
          confirmLabel="注文の確認へ進む"
          onExport={handleExport}
        />
      </div>

      {step === "confirm" && design && (
        <section aria-label="注文の確認">
          <h2>注文の確認</h2>
          <OutputPreview src={design.previewUrl} spec={badgeSpec} />

          {maxQuantity > 1 && (
            <div className="cb-quantity cb-gap-top">
              <span className="cb-field__label">個数</span>
              <div className="cb-quantity__controls">
                <Button
                  variant="line"
                  aria-label="個数を減らす"
                  disabled={quantity <= 1}
                  onClick={() => setQuantity((current) => Math.max(1, current - 1))}
                >
                  −
                </Button>
                <output className="cb-quantity__value" aria-live="polite">
                  {quantity} 個
                </output>
                <Button
                  variant="line"
                  aria-label="個数を増やす"
                  disabled={quantity >= maxQuantity}
                  onClick={() => setQuantity((current) => Math.min(maxQuantity, current + 1))}
                >
                  ＋
                </Button>
              </div>
            </div>
          )}

          <dl className="cb-summary cb-gap-top">
            <dt>金額</dt>
            <dd>
              <strong>{total}円</strong>
              {quantity > 1 && (
                <span className="cb-muted">
                  （{setting?.price}円 × {quantity}）
                </span>
              )}
            </dd>
          </dl>

          {!accepting && setting && (
            <Notice tone="error">
              {setting.busyMessage ?? "現在、注文を受け付けていません。"}
            </Notice>
          )}

          {accepting && (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                if (canSubmit) void submit.run();
              }}
            >
              <Checkbox
                label="自作の画像、または使ってよい画像です"
                checked={consent}
                onChange={(event) => setConsent(event.target.checked)}
              />
              {turnstileSiteKey && (
                <TurnstileWidget
                  siteKey={turnstileSiteKey}
                  onToken={setToken}
                  resetKey={tokenVersion}
                />
              )}
              <Button type="submit" size="large" block disabled={!canSubmit}>
                {submit.running ? "注文しています…" : "注文する"}
              </Button>
              <p className="cb-muted cb-center cb-gap-top">お金は、ブースのレジで現金で払います</p>
              {submit.error && <Notice tone="error">{submit.error}</Notice>}
            </form>
          )}

          <Button variant="line" block onClick={backToDesign} disabled={submit.running}>
            デザインに戻る
          </Button>
        </section>
      )}
    </main>
  );
}
