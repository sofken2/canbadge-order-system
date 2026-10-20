import { badgeSpec } from "@canbadge/badge-spec";
import {
  BadgeEditor,
  type BadgeEditorExport,
  clearDraft,
  LazyBadgePreview3D,
} from "@canbadge/editor";
import { acceptanceLabels } from "@canbadge/shared";
import { Button, Checkbox, Notice, navigate, useAction, useResource } from "@canbadge/ui";
import { useEffect, useRef, useState } from "react";
import { ArchivePostFields } from "./ArchivePostFields";
import { api } from "./api";
import {
  canPost,
  emptyPostForm,
  type PostFormState,
  postedMessage,
  postFailedAfterOrderMessage,
  toPostRequest,
} from "./archive-post-logic";
import { discordErrorMessage, readDiscordReturn } from "./discord-return";
import { DEV_TURNSTILE_TOKEN, discordEnabled, turnstileSiteKey } from "./env";
import { setFlash } from "./flash";
import { KiraFilmPicker, orderTotal } from "./KiraFilmPicker";
import { QuantityPicker } from "./QuantityPicker";
import { TurnstileWidget } from "./TurnstileWidget";

/** 作りかけのデザインの、ブラウザ内の保存名。注文が済んだら消す */
const DRAFT_KEY = "order-design";
/** Discord のアイコンを置く大きさ（mm）。印刷円の 70mm いっぱいに伸ばすと端が切れるので、内径 58mm より少し大きいくらいに収める */
const DISCORD_ICON_FIT_MM = 60;
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
  // Discord から戻ってきたとき（W08）：取り込めたアイコンをエディタの最初の写真にし、失敗なら理由を伝える。
  // 読んだら、アドレスから消す（再読み込みで、同じ通知や、期限切れの画像を、もう一度使わないように）
  const [discordReturn] = useState(() => readDiscordReturn(window.location.search));
  useEffect(() => {
    if (discordReturn) window.history.replaceState(null, "", window.location.pathname);
  }, [discordReturn]);
  const discordImage =
    discordReturn && "imageId" in discordReturn
      ? api.url("getImage", { params: { imageId: discordReturn.imageId } })
      : undefined;
  const [design, setDesign] = useState<Design | undefined>(undefined);
  const [step, setStep] = useState<"design" | "confirm">("design");
  const [quantity, setQuantity] = useState(1);
  const [kiraSelected, setKiraSelected] = useState(0);
  // 個数を減らしたとき、キラの個数が個数を超えないようにする
  const kiraQuantity = Math.min(kiraSelected, quantity);
  const [consent, setConsent] = useState(false);
  // 注文と同時に、みんなの作品として公開する（任意）。公開しなくても、注文できる
  const [publish, setPublish] = useState(false);
  const [postForm, setPostForm] = useState<PostFormState>(emptyPostForm);
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
          kiraQuantity,
          turnstileToken: turnstileSiteKey ? (token ?? "") : DEV_TURNSTILE_TOKEN,
          rightsConsent: true,
        },
      });
      // 注文は、できている。投稿が失敗しても、注文は止めず、注文状況の画面で伝える
      if (publish) {
        try {
          await api.call("createArchiveEntry", {
            body: { imageId, editorData: design.editorData, ...toPostRequest(postForm) },
          });
          setFlash({ tone: "info", text: postedMessage });
        } catch (error) {
          setFlash({
            tone: "error",
            text: postFailedAfterOrderMessage(error instanceof Error ? error.message : "原因不明"),
          });
        }
      }
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
  const canSubmit =
    accepting &&
    consent &&
    (!publish || canPost(postForm)) &&
    (!needsToken || token !== undefined) &&
    !submit.running;

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

  const total = orderTotal(setting, quantity, kiraQuantity);

  return (
    <main className="cb-page">
      <h1>オリジナル缶バッジを、つくろう</h1>
      {status.error && <Notice tone="error">{status.error}</Notice>}
      {setting && (
        <p className="cb-muted">
          受付：{acceptanceLabels[setting.acceptance]} ／ {setting.price}円 / 1個（キラフィルム +
          {setting.kiraFilmPrice}円）／ いま
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
        {discordReturn && "error" in discordReturn && (
          <Notice tone="error">{discordErrorMessage(discordReturn.error)}</Notice>
        )}
        {discordEnabled && (
          <div>
            <Button
              variant="line"
              // Discord の許可画面へ移る（ページを離れる）。戻ると、アイコンがエディタに読み込まれる
              onClick={() => window.location.assign(api.url("discordAuthorize"))}
            >
              Discord のアイコンを使う
            </Button>
            <p className="cb-muted">
              許可すると、アイコンが読み込まれます（いまの編集は、置き換わります）
            </p>
          </div>
        )}
        <BadgeEditor
          spec={badgeSpec}
          draftKey={DRAFT_KEY}
          {...(discordImage ? { initialImage: discordImage, imageFitMm: DISCORD_ICON_FIT_MM } : {})}
          confirmLabel="注文の確認へ進む"
          onExport={handleExport}
        />

        {/* ほかの入口の案内。スマホで、エディタが画面の上のほうに来るよう、エディタのあとに置く */}
        <div className="cb-gap-top">
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
          <p className="cb-muted">
            他のお客さんが公開してくれた作品を、
            <a
              href="/archive"
              onClick={(event) => {
                event.preventDefault();
                navigate("/archive");
              }}
            >
              みんなの作品
            </a>
            で見られます。注文はせずに、作品だけを投稿したい方は、
            <a
              href="/archive/post"
              onClick={(event) => {
                event.preventDefault();
                navigate("/archive/post");
              }}
            >
              作品だけ投稿する
            </a>
            。投稿した作品は、
            <a
              href="/archive/mine"
              onClick={(event) => {
                event.preventDefault();
                navigate("/archive/mine");
              }}
            >
              自分の投稿
            </a>
            から、取り下げられます。
          </p>
        </div>
      </div>

      {step === "confirm" && design && (
        <section aria-label="注文の確認">
          <h2>注文の確認</h2>
          <LazyBadgePreview3D src={design.previewUrl} spec={badgeSpec} />

          <QuantityPicker value={quantity} max={maxQuantity} onChange={setQuantity} />
          {setting && (
            <KiraFilmPicker
              value={kiraQuantity}
              quantity={quantity}
              price={setting.kiraFilmPrice}
              onChange={setKiraSelected}
            />
          )}

          <dl className="cb-summary cb-gap-top">
            <dt>金額</dt>
            <dd>
              <strong>{total}円</strong>
              {(quantity > 1 || kiraQuantity > 0) && setting && (
                <span className="cb-muted">
                  （{setting.price}円 × {quantity}
                  {kiraQuantity > 0 && ` + キラ ${setting.kiraFilmPrice}円 × ${kiraQuantity}`}）
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
              <Checkbox
                label="この作品を、「みんなの作品」として、公開してもよい（任意）"
                checked={publish}
                onChange={(event) => setPublish(event.target.checked)}
              />
              {publish && (
                <ArchivePostFields
                  value={postForm}
                  onChange={setPostForm}
                  disabled={submit.running}
                />
              )}
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
