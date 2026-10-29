import { badgeSpec } from "@canbadge/badge-spec";
import {
  type BadgeBack,
  type BadgeFilm,
  createSampleArtwork,
  DRAFT_CHANGE_EVENT,
  LazyBadgePreview3D,
  loadDraft,
} from "@canbadge/editor";
import { acceptanceLabels } from "@canbadge/shared";
import { Button, Notice, navigate, useResource } from "@canbadge/ui";
import { type ChangeEvent, useEffect, useRef, useState } from "react";
import { api } from "./api";
import { discordEnabled } from "./env";
import { ImageSourceDialog } from "./ImageSourceDialog";
import { ORDER_DRAFT_KEY } from "./order-draft";
import { TryOnDialog } from "./TryOnDialog";
import "./home.css";

/** 支払いと受け取りをするブースの場所。設定にはないので、LP の案内にだけ書く */
const BOOTH_PLACE = "旭祭 2号館 2705教室";

/** 投稿のあとのお知らせを出しておく時間（ms）。1 画面の LP に重ねるので、読めるだけ出して、自然に消す */
const POSTED_NOTICE_MS = 6000;

/**
 * はじめの画面。3D の缶バッジの見本と、やりたいことの入口（注文・作品を見る・自分の注文を確認）。
 * 缶バッジを押す（下の「画像をはめてみる」でも）と、まず画像を選び、その写真で編集画面が開く。画像をはめたあとは、
 * 押すと今のデザインの編集画面が開き、画像はその中（キャンバスの左上の「画像を変える」）で替える。
 * 写真をはめるエディタは、画面に重ねて開く（モーダル）。PC は、はじめの画面も、モーダルの中も、左にプレビュー、右に操作
 */
export function HomePage() {
  const [sample, setSample] = useState<string>();
  // はめてみたデザイン（PNG の一時的なアドレス）。あれば、見本の代わりに、これを 3D に貼る。
  // 正しいのは、いつも途中保存（注文画面と同じ）のほう。ここは、その絵を写して持つだけ（開いたとき・保存が変わったときに写す）
  const [design, setDesign] = useState<string>();
  const [tryOpen, setTryOpen] = useState(false);
  // 画像の取り込み元（デバイス・Discord）を選ぶ画面
  const [sourceOpen, setSourceOpen] = useState(false);
  // 開く前に選んだ写真。なければ、途中保存の続きを開く
  const [picked, setPicked] = useState<Blob>();
  const fileRef = useRef<HTMLInputElement>(null);
  // 3D の裏の作り。マグネットのボタンで、安全ピンとマグネット加工を見比べる（注文の選択とは別。見るだけ）
  const [back, setBack] = useState<BadgeBack>("pin");
  // 3D のキラフィルム。割れガラス・オーロラのボタンで、付けた見た目を見比べる（これも見るだけ）
  const [film, setFilm] = useState<BadgeFilm>("none");
  const toggleFilm = (next: BadgeFilm) => setFilm((current) => (current === next ? "none" : next));
  // 「バッジを注文する」から始めたか。決定で、注文の確認へ進む（はめてみるだけのときは、閉じるだけ）
  const [orderIntent, setOrderIntent] = useState(false);
  // 決定のあと、エディタが閉じて保存し終えたら、注文の確認へ移る（保存の前に移ると、注文画面が古いデザインを読む）
  const goOrderAfterSave = useRef(false);
  // 値段と待ち件数は、設定（スタッフが変えられる）から出す。読めないあいだは「—」にして、作った数字を出さない
  const status = useResource(() => api.call("getStatus"), { refreshMs: 15000 });
  const setting = status.data;
  // 受付が止まっているとき（混雑・終了）は、注文の入口を押せなくする。デザインを作ってから、確認で断られないように。
  // 読めないあいだは押せるままにする（確認の画面で、あらためて受付を確かめる）
  const orderClosed = !!setting && setting.acceptance !== "open";

  // 作品を投稿したあと（/?posted=1）は、受け付けたことを短く知らせる。読んだら、アドレスから消す（再読み込みで、もう一度出さない）
  const [posted, setPosted] = useState(
    () => new URLSearchParams(window.location.search).get("posted") === "1",
  );
  useEffect(() => {
    if (!posted) return;
    window.history.replaceState(null, "", window.location.pathname);
    const timer = setTimeout(() => setPosted(false), POSTED_NOTICE_MS);
    return () => clearTimeout(timer);
  }, [posted]);

  useEffect(() => {
    let cancelled = false;
    createSampleArtwork(badgeSpec)
      .then((src) => {
        if (!cancelled) setSample(src);
      })
      // 見本が描けなくても、画面の操作には困らない。バッジの枠を出さないだけ
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  const showPreview = (preview: Blob | undefined) =>
    setDesign(preview ? URL.createObjectURL(preview) : undefined);

  const onDraftChange = (preview: Blob | undefined, saved: boolean) => {
    // 書けたときは、下の DRAFT_CHANGE_EVENT で読み直して出す（ここでも出すと、3D の貼り替えが 2 回になる）。
    // 書けない端末（途中保存が使えない）では、イベントが来ないので、ここで出す
    if (!saved) showPreview(preview);
    if (goOrderAfterSave.current) {
      goOrderAfterSave.current = false;
      // 注文画面へは、途中保存でデザインを渡す。書けなかったときは、確認へ飛ばさず、編集から始めてもらう
      // （確認へ飛ばすと、読み込むデザインがなく、空のエディタで止まる）
      navigate(saved ? "/order?next=confirm" : "/order");
    }
  };

  // 途中保存の絵を出す。開いたときと、途中保存が変わったとき（書き込みが遅れて終わったときも）に読み直す。
  // 途中保存がなくなっていれば（注文が済んだ・やり直した）、見本に戻す
  useEffect(() => {
    let latest = 0;
    const reload = () => {
      const call = ++latest;
      void loadDraft(ORDER_DRAFT_KEY).then((saved) => {
        // 続けて変わったときは、最後に読んだものだけを使う
        if (call !== latest) return;
        setDesign(saved?.preview ? URL.createObjectURL(saved.preview) : undefined);
      });
    };
    const onChange = (event: Event) => {
      if (event instanceof CustomEvent && event.detail === ORDER_DRAFT_KEY) reload();
    };
    reload();
    window.addEventListener(DRAFT_CHANGE_EVENT, onChange);
    return () => {
      latest = -1;
      window.removeEventListener(DRAFT_CHANGE_EVENT, onChange);
    };
  }, []);

  // 前のデザインのアドレスは、替えたときと、画面を離れるときに捨てる
  useEffect(() => {
    if (!design) return;
    return () => URL.revokeObjectURL(design);
  }, [design]);

  // 「缶バッジで見る」は、閉じるだけ。絵は、途中保存が知らせてくる（onDraftChange）
  const closeTry = () => {
    setTryOpen(false);
    setPicked(undefined);
    setOrderIntent(false);
  };

  // 決定を押したとき。注文から始めていたら、保存が済みしだい、注文の確認へ進む
  const onExport = () => {
    if (orderIntent) goOrderAfterSave.current = true;
    closeTry();
  };

  // 画像を選ぶ画面を開く。押した操作の中で呼ぶ（そうしないと、スマホのブラウザが開かせない）
  const pickImage = () => fileRef.current?.click();

  // 選んだら、その写真で編集画面を開く
  const onPicked = (event: ChangeEvent<HTMLInputElement>) => {
    const input = event.currentTarget;
    const file = input.files?.[0];
    // 同じ写真をもう一度選んでも、選んだことになるよう、空にしておく
    input.value = "";
    if (!file) return;
    setPicked(file);
    setTryOpen(true);
  };

  // 缶バッジを押したとき・下のボタン。まだ画像がなければ、まず画像を選ぶ。あれば、今のデザインの編集を開く
  const startTry = () => {
    setOrderIntent(false);
    if (design) setTryOpen(true);
    // 取り込み元が 2 つ（デバイス・Discord）のときだけ、選ばせる。1 つなら、そのまま画像を選ぶ画面へ
    else if (discordEnabled) setSourceOpen(true);
    else pickImage();
  };

  const pickFromDevice = () => {
    setSourceOpen(false);
    pickImage();
  };

  // 「バッジを注文する」。画像がまだなければ、はめるところから（選ぶ → 編集 → 注文の確認）。
  // あれば、注文画面で編集を見せず、そのまま注文の確認へ進む（触ってずれるのを防ぐ）
  const startOrder = () => {
    if (design) {
      navigate("/order?next=confirm");
      return;
    }
    setOrderIntent(true);
    pickImage();
  };

  const artwork = design ?? sample;

  return (
    <main className="cb-page cb-home">
      <header className="cb-home__head">
        <h1>
          あなたの画像を
          <br />
          缶バッジに
        </h1>
        <p className="cb-home__lead">
          スマホで画像をはめて注文し、ブースで支払うと、印刷して組み立てます。
        </p>
      </header>

      <section className="cb-home__stage" aria-label="缶バッジのプレビュー">
        <div className="cb-home__badge">
          {artwork && (
            <LazyBadgePreview3D
              back={back}
              film={film}
              src={artwork}
              spec={badgeSpec}
              onTap={startTry}
              flatWhileLoading={false}
              label={
                design
                  ? `はめてみたデザインの缶バッジ（直径 ${badgeSpec.diameterMm}mm、3D）。ドラッグで回せます`
                  : `缶バッジ（直径 ${badgeSpec.diameterMm}mm）の見本（3D）。ドラッグで回すと、裏の安全ピンが見られます`
              }
            />
          )}
        </div>
        <div className="cb-home__actions">
          {/* 見比べるボタン。PC は缶バッジの右上に縦に、スマホは「デザインを編集する」の左（裏の作り）と右（キラフィルム）に並べる */}
          <div className="cb-home__looks cb-home__looks--back">
            <button
              type="button"
              className="cb-home__magnet"
              aria-pressed={back === "magnet"}
              aria-label="マグネット加工を付けて見る"
              title="マグネット加工"
              onClick={() => setBack((current) => (current === "magnet" ? "pin" : "magnet"))}
            >
              {/* U 字の磁石 */}
              <svg
                viewBox="0 0 24 24"
                width="20"
                height="20"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M6 3v9a6 6 0 0 0 12 0V3" />
                <path d="M6 7h4M14 7h4" />
                <path d="M10 3v9a2 2 0 0 0 4 0V3" />
              </svg>
            </button>
          </div>
          {/* 加工の丸とは別の段にするための入れ物（スマホ：上の段に丸、下の段にこのボタン） */}
          <div className="cb-home__tryrow">
            <Button variant="line" className="cb-home__try" onClick={startTry}>
              {design ? "デザインを編集する" : "画像をはめてみる"}
            </Button>
          </div>
          <div className="cb-home__looks cb-home__looks--film">
            <button
              type="button"
              className="cb-home__magnet"
              aria-pressed={film === "shards"}
              aria-label="キラフィルム（割れガラス）を付けて見る"
              title="キラフィルム（割れガラス）"
              onClick={() => toggleFilm("shards")}
            >
              {/* 割れたガラスの破片 */}
              <svg
                viewBox="0 0 24 24"
                width="20"
                height="20"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M12 3 4 9l3 11h10l3-11z" />
                <path d="M12 3l-1 7 6 1M11 10l-4 10M11 10l9-1" />
              </svg>
            </button>
            <button
              type="button"
              className="cb-home__magnet"
              aria-pressed={film === "aurora"}
              aria-label="キラフィルム（オーロラ）を付けて見る"
              title="キラフィルム（オーロラ）"
              onClick={() => toggleFilm("aurora")}
            >
              {/* なめらかな虹（3 本の弧） */}
              <svg
                viewBox="0 0 24 24"
                width="20"
                height="20"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                aria-hidden="true"
              >
                <path d="M3 17a9 9 0 0 1 18 0" />
                <path d="M6.5 17a5.5 5.5 0 0 1 11 0" />
                <path d="M10 17a2 2 0 0 1 4 0" />
              </svg>
            </button>
          </div>
        </div>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          hidden
          tabIndex={-1}
          onChange={onPicked}
        />
      </section>

      <section className="cb-home__offer" aria-label="値段と注文">
        <dl className="cb-home__specs">
          <div>
            <dt>1個</dt>
            <dd>
              {setting ? setting.price : "—"}
              <small>円</small>
            </dd>
          </div>
          <div>
            <dt>直径</dt>
            <dd>
              {badgeSpec.diameterMm}
              <small>mm</small>
            </dd>
          </div>
        </dl>

        <ul className="cb-home__chips" aria-label="オプション">
          <li className="cb-home__chip">
            <span>キラフィルム 2種類</span>
            <strong>{setting ? `+${setting.kiraFilmPrice}円` : "—"}</strong>
          </li>
          <li className="cb-home__chip">
            <span>マグネット加工</span>
            <strong>{setting ? `+${setting.magnetPrice}円` : "—"}</strong>
          </li>
        </ul>

        <div className="cb-home__status">
          {setting && (
            <p
              className={`cb-status cb-home__queue${setting.acceptance === "open" ? " cb-status--done" : ""}`}
            >
              {acceptanceLabels[setting.acceptance]}
              {/* ビジーのときも、待ち件数と案内文を出す（仕様 14 章） */}
              {setting.acceptance !== "closed" && `・いま ${setting.waitingCount} 件待ち`}
            </p>
          )}
          {setting?.acceptance === "busy" && setting.busyMessage && (
            <p className="cb-muted">{setting.busyMessage}</p>
          )}
          <p className="cb-home__place">{BOOTH_PLACE}</p>
        </div>

        <Button block size="large" onClick={startOrder} disabled={orderClosed}>
          {design ? "注文の確認へ進む" : "バッジを注文する"}
        </Button>
        {/* 押せない理由は、上の受付の状況（と案内文）に出ている。ボタンのすぐ下でも、ひとこと伝える */}
        {orderClosed && <p className="cb-muted cb-home__closed">いまは注文できません</p>}

        <nav className="cb-home__links" aria-label="ほかの入口">
          <Button variant="line" size="large" block onClick={() => navigate("/lookup")}>
            自分の注文を確認する
          </Button>
          <Button variant="line" size="large" block onClick={() => navigate("/archive")}>
            みんなの作品を見る
          </Button>
        </nav>
      </section>

      <ImageSourceDialog
        open={sourceOpen}
        onClose={() => setSourceOpen(false)}
        onPickDevice={pickFromDevice}
        // Discord の許可画面へ移る（ページを離れる）。戻ると、注文画面のエディタにアイコンが読み込まれる（W08）
        onPickDiscord={() => window.location.assign(api.url("discordAuthorize"))}
      />

      <TryOnDialog
        open={tryOpen}
        onClose={closeTry}
        onExport={onExport}
        onDraftChange={onDraftChange}
        confirmLabel={orderIntent ? "注文の確認へ進む" : "缶バッジで見る"}
        initialImage={picked}
      />

      {/* 投稿のあとのお知らせ。LP は 1 画面に収めているので、並びに入れず、上に重ねる */}
      {posted && (
        <div className="cb-home__toast">
          <Notice>
            <span>投稿しました。スタッフが確認してから公開されます</span>
            <button
              type="button"
              className="cb-home__toast-close"
              aria-label="お知らせを閉じる"
              onClick={() => setPosted(false)}
            >
              <svg
                viewBox="0 0 24 24"
                width="18"
                height="18"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                aria-hidden="true"
              >
                <path d="M6 6l12 12M18 6 6 18" />
              </svg>
            </button>
          </Notice>
        </div>
      )}
    </main>
  );
}
