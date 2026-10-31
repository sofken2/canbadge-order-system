import { badgeSpec } from "@canbadge/badge-spec";
import { OutputPreview } from "@canbadge/editor";
import { kiraPatternLabels, orderQrValue, orderStatusLabels } from "@canbadge/shared";
import {
  BackButton,
  Button,
  Notice,
  navigate,
  QrCode,
  StatusLabel,
  useResource,
} from "@canbadge/ui";
import { useEffect, useRef, useState } from "react";
import { api } from "./api";
import { rememberOrder } from "./my-orders";
import {
  guideFor,
  justBecameReady,
  PROGRESS_STEPS,
  progressIndex,
  showsQr,
  stepState,
} from "./order-status";
import { PublishOffer } from "./PublishOffer";
import "./order-status.css";
import { useDelayedFlag } from "./use-delayed";

/** 取り直しの失敗が、これだけ続いたら、「つながっていない」と見せる（ms）。一瞬の失敗は、見せない */
const OFFLINE_NOTICE_DELAY_MS = 10_000;

/** できあがりを知らせる、振動の長さ（ms）。短く、2 回 */
const READY_VIBRATION = [200, 100, 200];

/**
 * 注文状況。レジで見せる QR（中身は注文 ID）、注文番号、受け取りで言う確認コードと、いまの状態を出す。
 * 状態は、SSE の通知（変わった）で、取り直す。放置されて、あとで画面に戻ったときも、取り直す
 */
export function OrderStatusPage({ orderId }: { orderId: string }) {
  const order = useResource(() => api.call("getOrder", { params: { orderId } }), {
    deps: [orderId],
    subscribe: (reload) => {
      // 「変わった」の通知と、つながったとき（再接続も含む）に、取り直す
      const stop = api.subscribe("orderEvents", {
        params: { orderId },
        onEvent: reload,
        onOpen: reload,
      });
      // 画面を閉じていた間（スマホを閉じて、レジに並んでいる間）の変化は、通知が届かないことがある。
      // 画面に戻ったとき、回線が戻ったときに、最新の状態を取り直す
      const onVisible = () => {
        if (document.visibilityState === "visible") reload();
      };
      document.addEventListener("visibilitychange", onVisible);
      window.addEventListener("online", reload);
      return () => {
        stop();
        document.removeEventListener("visibilitychange", onVisible);
        window.removeEventListener("online", reload);
      };
    },
  });

  const data = order.data;

  // 開けた注文を、この端末に覚えておく（「自分の注文を確認する」で、番号を入れずに開けるように）。
  // 通常の注文・作品からの注文・番号での照会は、どれもこの画面を開くので、ここで覚えれば足りる
  const opened = data !== undefined;
  useEffect(() => {
    if (opened) rememberOrder(orderId);
  }, [opened, orderId]);
  const status = data?.status;
  // いまの状態が出ているときの、取り直しの失敗は、再接続で自然に直ることが多い。続くときだけ知らせる
  const showRefreshError = useDelayedFlag(!!order.error && !!data, OFFLINE_NOTICE_DELAY_MS);

  // できあがりになった瞬間に、振動で知らせる（最初の表示や、できあがりのままの更新では、鳴らさない）
  const previous = useRef<typeof status>(undefined);
  useEffect(() => {
    if (status && justBecameReady(previous.current, status)) {
      navigator.vibrate?.(READY_VIBRATION);
    }
    previous.current = status;
  }, [status]);

  // 別のタブに切り替えていても、できあがりがわかるよう、表題に注文番号と状態を出す
  useEffect(() => {
    if (!data) return;
    const before = document.title;
    document.title = `${data.orderNumberText} ${orderStatusLabels[data.status]}｜缶バッジ注文`;
    return () => {
      document.title = before;
    };
  }, [data]);

  if (order.error && !data) {
    return (
      <main className="cb-page">
        <BackButton className="cb-back--page" onClick={() => navigate("/")} />
        <h1>注文が見つかりません</h1>
        <Notice tone="error">{order.error}</Notice>
        <p className="cb-muted">
          お手数ですが、注文したときの画面をもう一度開くか、ブースのスタッフにお声がけください。
        </p>
        <Button block onClick={() => navigate("/lookup")}>
          注文番号と確認コードで注文を開く
        </Button>
      </main>
    );
  }
  if (!data) {
    return (
      <main className="cb-page">
        <p className="cb-muted" role="status">
          読み込んでいます…
        </p>
      </main>
    );
  }

  const guide = guideFor(data.status, data);
  const current = progressIndex(data.status);
  const tone =
    data.status === "ready" || data.status === "picked_up"
      ? "done"
      : current !== undefined
        ? "active"
        : "neutral";

  return (
    <main className="cb-page cb-ticket">
      <div className="cb-ticket__main">
        <BackButton className="cb-back--page" onClick={() => navigate("/")} />
        <header className="cb-ticket__head" data-tone={guide.tone}>
          <StatusLabel label={orderStatusLabels[data.status]} tone={tone} />
          {/* 見出しは、状態が変わったら、読み上げにも届ける */}
          <h1 aria-live="polite">{guide.headline}</h1>
          <p>{guide.body}</p>
        </header>

        {/* 後で、待合画面の動くキャラクター（GIF・アニメ）を入れる場所。全体の見た目は、ここでは変えない */}

        {showRefreshError && (
          <Notice tone="info">
            最新の状態を取得できていません。つながりしだい、自動で更新します（いまの表示は、前に取得したものです）
          </Notice>
        )}

        {showsQr(data.status) && (
          <section className="cb-ticket__qr" aria-label="注文の QR コード">
            <QrCode
              value={orderQrValue(data.id, data.confirmationCode)}
              label={`注文 ${data.orderNumberText} の QR コード`}
            />
            <p className="cb-muted">
              {data.status === "submitted"
                ? "レジでこの QR を読み取り機に向けてください"
                : "受け取りのときもこの QR を見せてください"}
            </p>
          </section>
        )}

        <dl className="cb-ticket__ids">
          <div>
            <dt>注文番号</dt>
            <dd className="cb-ticket__number">{data.orderNumberText}</dd>
          </div>
          <div>
            <dt>確認コード（受け取りのときにお伝えください）</dt>
            <dd className="cb-ticket__code">{data.confirmationCode}</dd>
          </div>
        </dl>

        {/* 進み具合の横（右）に、注文したバッジを並べる。進み具合がないときは、バッジだけ */}
        <div className="cb-ticket__flow">
          {current !== undefined && (
            <ol className="cb-progress" aria-label="進み具合">
              {PROGRESS_STEPS.map((label, index) => {
                const state = stepState(index, current);
                return (
                  <li
                    key={label}
                    data-state={state}
                    aria-current={state === "now" ? "step" : undefined}
                  >
                    {label}
                    {state === "done" && <span className="cb-visually-hidden">（済み）</span>}
                  </li>
                );
              })}
            </ol>
          )}

          <div className="cb-ticket__items">
            {data.items.map((item) => (
              <div key={item.id} className="cb-ticket__item">
                <OutputPreview src={item.thumbnailUrl} spec={badgeSpec} />
                {(item.kiraQuantity > 0 || item.magnetQuantity > 0) && (
                  <p className="cb-muted">
                    {item.kiraQuantity > 0 &&
                      `キラフィルム ${item.kiraQuantity} 個${item.kiraPattern ? `（柄：${kiraPatternLabels[item.kiraPattern]}）` : ""}`}
                    {item.kiraQuantity > 0 && item.magnetQuantity > 0 && " ／ "}
                    {item.magnetQuantity > 0 && `マグネット加工 ${item.magnetQuantity} 個`}
                  </p>
                )}
              </div>
            ))}
          </div>
        </div>

        <p className="cb-ticket__amount">
          <strong>{data.totalAmount}円</strong>
          {/* 支払いの案内は、支払う前だけ。支払い後・返金後に出すと、まだ払っていないように読める */}
          {data.status === "submitted" && (
            <>
              <br />
              お金は、ブースのレジで現金で払います
            </>
          )}
        </p>
      </div>

      {/*
       * 「みんなの作品として公開しますか」。注文の確認・支払いのじゃまをしないよう、スマホは一番下、PC は右側に置く
       * （order-status.css）。案内がないときは、何も出さない
       */}
      <aside className="cb-ticket__aside">
        <PublishOffer orderId={orderId} />
      </aside>
    </main>
  );
}
