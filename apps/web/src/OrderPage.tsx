import { badgeSpec } from "@canbadge/badge-spec";
import {
  BadgeEditor,
  type BadgeEditorExport,
  clearDraft,
  LazyBadgePreview3D,
} from "@canbadge/editor";
import { acceptanceLabels } from "@canbadge/shared";
import {
  BackButton,
  Button,
  Checkbox,
  Notice,
  navigate,
  useAction,
  useResource,
} from "@canbadge/ui";
import { useEffect, useRef, useState } from "react";
import { AddonPicker, orderTotal } from "./AddonPicker";
import { api } from "./api";
import { SELF_MADE_LABEL } from "./archive-post-logic";
import { discordErrorMessage, readDiscordReturn } from "./discord-return";
import { DEV_TURNSTILE_TOKEN, discordEnabled, turnstileSiteKey } from "./env";
import { KiraPatternPicker } from "./KiraPatternPicker";
import { type KiraPattern, kiraRemainingOf, usablePattern } from "./kira-pattern";
import { ORDER_DRAFT_KEY } from "./order-draft";
import { savePublishOffer } from "./publish-offer";
import { QuantityPicker } from "./QuantityPicker";
import { TryOnDialog } from "./TryOnDialog";
import "./tryon.css";
import { TurnstileWidget } from "./TurnstileWidget";

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
  // はじめの画面の「注文の確認へ進む」から来たとき（?next=confirm）。デザインはもう決まっているので、
  // 編集を触らせず（触ってずれるのを防ぐ）、途中保存から、そのまま注文の確認へ進む。読んだら、アドレスから消す
  // （読み込み直したときは、ふつうに編集から始める）
  const [skipToConfirm] = useState(
    () => new URLSearchParams(window.location.search).get("next") === "confirm",
  );
  // 最初のデザインの段か。自動で確認へ進む・Discord のアイコンで始めるのは、最初の 1 回だけ。
  // 確認から「戻る」でデザインに戻ったときは、途中保存（直したデザイン）の続きを見せる
  const [firstDesign, setFirstDesign] = useState(true);
  // Discord から戻ってきたとき（W08）：取り込めたアイコンをエディタの最初の写真にし、失敗なら理由を伝える。
  // 読んだら、アドレスから消す（再読み込みで、同じ通知や、期限切れの画像を、もう一度使わないように）
  const [discordReturn] = useState(() => readDiscordReturn(window.location.search));
  useEffect(() => {
    if (discordReturn || skipToConfirm)
      window.history.replaceState(null, "", window.location.pathname);
  }, [discordReturn, skipToConfirm]);
  const discordImage =
    discordReturn && "imageId" in discordReturn
      ? api.url("getImage", { params: { imageId: discordReturn.imageId } })
      : undefined;
  const [design, setDesign] = useState<Design | undefined>(undefined);
  const [step, setStep] = useState<"design" | "confirm">("design");
  const [quantitySelected, setQuantity] = useState(1);
  // 1 回に注文できる個数は、設定の上限と、バッジの在庫の残りの小さいほう
  const maxQuantity = Math.max(
    1,
    Math.min(status.data?.maxQuantityPerOrder ?? 1, status.data?.badgeRemaining ?? 1),
  );
  // 上限が選んだ個数より下がると、上限 1 では選ぶ欄も消えて直せなくなるので、ここで上限に合わせる
  const quantity = Math.min(quantitySelected, maxQuantity);
  const [kiraSelected, setKiraSelected] = useState(0);
  const [magnetSelected, setMagnetSelected] = useState(0);
  // キラフィルムの柄。確認の 3D に貼って見せる（注文には、まだ記録できない。kira-pattern.ts）
  const [kiraWanted, setKiraPattern] = useState<KiraPattern>("shards");
  // 在庫は柄ごと。選んだ柄が売り切れなら、残りのある柄に替える
  const kiraRemaining = kiraRemainingOf(status.data);
  const kiraPattern = usablePattern(kiraWanted, kiraRemaining);
  // 個数や在庫の残りが減ったとき、加工の個数が、その数を超えないようにする
  const kiraQuantity = Math.min(kiraSelected, quantity, kiraRemaining?.[kiraPattern] ?? quantity);
  const magnetQuantity = Math.min(
    magnetSelected,
    quantity,
    status.data?.magnetRemaining ?? quantity,
  );
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
          kiraQuantity,
          ...(kiraQuantity > 0 ? { kiraPattern } : {}),
          magnetQuantity,
          turnstileToken: turnstileSiteKey ? (token ?? "") : DEV_TURNSTILE_TOKEN,
          rightsConsent: true,
        },
      });
      // みんなの作品として公開するかは、注文のあと（注文状況の画面）で聞く。そのための材料を渡す
      savePublishOffer(orderId, { imageId, editorData: design.editorData });
      await clearDraft(ORDER_DRAFT_KEY);
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
  const soldOut = !!setting && setting.badgeRemaining <= 0;
  const needsToken = turnstileSiteKey !== undefined;
  const canSubmit =
    accepting && !soldOut && consent && (!needsToken || token !== undefined) && !submit.running;

  const handleExport = (output: BadgeEditorExport) => {
    setDesign({ ...output, previewUrl: URL.createObjectURL(output.png) });
    setConsent(false);
    setStep("confirm");
    window.scrollTo({ top: 0 });
  };

  // 「デザインを編集する」：はじめの画面と同じ、全画面の編集画面を開く（PC は左右 2 列）。決定すると、直したデザインで確認に戻る。
  // 「戻る」で閉じたときは、確認と注文は、編集に入る前のデザインのまま（直した中身は途中保存に残る）
  const [reEditOpen, setReEditOpen] = useState(false);
  const openReEdit = () => {
    submit.clearError();
    setReEditOpen(true);
  };
  const handleReEditExport = (output: BadgeEditorExport) => {
    setReEditOpen(false);
    handleExport(output);
  };

  const total = orderTotal(setting, quantity, kiraQuantity, magnetQuantity);

  // 確認の段では、「戻る」はデザインの段へ（はじめの画面へ戻ると、選んだ個数などを考え直す途中で抜けてしまう）
  const goBack = () => {
    if (step === "confirm") {
      submit.clearError();
      setFirstDesign(false);
      setStep("design");
      window.scrollTo({ top: 0 });
      return;
    }
    navigate("/");
  };

  return (
    // デザインの段は、PC で左にキャンバス、右に操作を並べる（tryon.css の .cb-editpage。はじめの画面のモーダルと同じ並び）
    <main className={step === "design" ? "cb-page cb-editpage" : "cb-page"}>
      <BackButton className="cb-back--page" onClick={goBack} />
      {status.error && <Notice tone="error">{status.error}</Notice>}

      {/*
       * 最初のデザイン（と、自動で確認へ進むとき）だけ、ここのエディタを使う。確認に進んだら外す。
       * つないだまま残すと、画面を離れるときの保存で、「デザインを編集する」で直した途中保存を、古い中身で上書きしてしまう
       */}
      {step === "design" && (
        <div>
          <h1>デザインを作る</h1>
          {/* 受付が止まっているときは、デザインを作り始める前に伝える（確認まで進んでから断らない） */}
          {setting && !accepting && (
            <Notice tone="error">
              {setting.busyMessage ??
                `${acceptanceLabels[setting.acceptance]}のため、いまは注文できません。`}
            </Notice>
          )}
          {firstDesign && discordReturn && "error" in discordReturn && (
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
            draftKey={ORDER_DRAFT_KEY}
            {...(discordImage && firstDesign
              ? { initialImage: discordImage, imageFitMm: DISCORD_ICON_FIT_MM }
              : {})}
            confirmLabel="注文の確認へ進む"
            exportWhenReady={firstDesign && skipToConfirm && !discordImage}
            onExport={handleExport}
          />
        </div>
      )}

      <TryOnDialog
        open={reEditOpen}
        onClose={() => setReEditOpen(false)}
        onExport={handleReEditExport}
        onDraftChange={() => undefined}
        confirmLabel="注文の確認へ進む"
      />

      {step === "confirm" && design && (
        <section aria-label="注文の確認">
          <h1>注文の確認</h1>
          {/* マグネット加工・キラフィルムを付けたら、3D にも反映する（仕上がりを、そのまま確かめられるように） */}
          <LazyBadgePreview3D
            src={design.previewUrl}
            spec={badgeSpec}
            back={magnetQuantity > 0 ? "magnet" : "pin"}
            film={kiraQuantity > 0 ? kiraPattern : "none"}
          />

          <QuantityPicker value={quantity} max={maxQuantity} onChange={setQuantity} />
          {setting && (
            <>
              <AddonPicker
                name="キラフィルム"
                value={kiraQuantity}
                quantity={quantity}
                price={setting.kiraFilmPrice}
                remaining={kiraRemaining?.[kiraPattern] ?? 0}
                onChange={setKiraSelected}
              />
              {kiraQuantity > 0 && (
                <KiraPatternPicker
                  value={kiraPattern}
                  remaining={kiraRemaining}
                  onChange={setKiraPattern}
                />
              )}
              <AddonPicker
                name="マグネット加工"
                value={magnetQuantity}
                quantity={quantity}
                price={setting.magnetPrice}
                remaining={setting.magnetRemaining}
                onChange={setMagnetSelected}
              />
            </>
          )}

          <dl className="cb-summary cb-gap-top">
            <dt>金額</dt>
            <dd>
              <strong>{total}円</strong>
            </dd>
          </dl>

          {soldOut && (
            <Notice tone="error">バッジの在庫がなくなりました。ご注文を受け付けられません。</Notice>
          )}

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
              {/* 権利の同意は、金額の下、注文ボタンの直前で確かめる。公開するかは、注文のあとで聞く */}
              <Checkbox
                label={SELF_MADE_LABEL}
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

          <Button variant="line" block onClick={openReEdit} disabled={submit.running}>
            デザインを編集する
          </Button>
        </section>
      )}
    </main>
  );
}
