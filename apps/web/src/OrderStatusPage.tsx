import { badgeSpec } from "@canbadge/badge-spec";
import { OutputPreview } from "@canbadge/editor";
import { orderStatusLabels } from "@canbadge/shared";
import { Button, Notice, navigate, QrCode, StatusLabel, useResource } from "@canbadge/ui";
import { useEffect, useRef, useState } from "react";
import { api } from "./api";
import { takeFlash } from "./flash";
import {
  guideFor,
  justBecameReady,
  PROGRESS_STEPS,
  progressIndex,
  showsQr,
  stepState,
} from "./order-status";
import "./order-status.css";

/** できあがりを知らせる、振動の長さ（ms）。短く、2 回 */
const READY_VIBRATION = [200, 100, 200];

/**
 * 注文状況。レジで見せる QR（中身は注文 ID）、注文番号、受け渡しで言う確認コードと、いまの状態を出す。
 * 状態は、SSE の通知（変わった）で、取り直す。放置されて、あとで画面に戻ったときも、取り直す
 */
export function OrderStatusPage({ orderId }: { orderId: string }) {
  // 注文の確定のあとに、1 回だけ出すお知らせ（例：作品の投稿が、できなかった）。再読み込みでは、出さない
  const [flash] = useState(() => takeFlash());
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
  const status = data?.status;

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
        <h1>注文が見つかりません</h1>
        <Notice tone="error">{order.error}</Notice>
        <p className="cb-muted">
          お手数ですが、注文したときの画面をもう一度開くか、ブースのスタッフにお声がけください。
        </p>
        <Button block onClick={() => navigate("/lookup")}>
          注文番号と確認コードで、注文を開く
        </Button>
        <Button variant="line" block onClick={() => navigate("/")}>
          はじめの画面に戻る
        </Button>
      </main>
    );
  }
  if (!data) {
    return (
      <main className="cb-page">
        <p className="cb-muted" role="status">
          読み込み中…
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
      <header className="cb-ticket__head" data-tone={guide.tone}>
        <StatusLabel label={orderStatusLabels[data.status]} tone={tone} />
        {/* 見出しは、状態が変わったら、読み上げにも届ける */}
        <h1 aria-live="polite">{guide.headline}</h1>
        <p>{guide.body}</p>
      </header>

      {/* 後で、待合画面の動くキャラクター（GIF・アニメ）を入れる場所。全体の見た目は、ここでは変えない */}

      {flash && <Notice tone={flash.tone}>{flash.text}</Notice>}
      {order.error && <Notice tone="error">{order.error}</Notice>}

      {showsQr(data.status) && (
        <section className="cb-ticket__qr" aria-label="注文の QR コード">
          <QrCode value={data.id} label={`注文 ${data.orderNumberText} の QR コード`} />
          <p className="cb-muted">レジで、この QR を、読み取り機に向けてください</p>
        </section>
      )}

      <dl className="cb-ticket__ids">
        <div>
          <dt>注文番号</dt>
          <dd className="cb-ticket__number">{data.orderNumberText}</dd>
        </div>
        <div>
          <dt>確認コード（受け取りのとき、お伝えください）</dt>
          <dd className="cb-ticket__code">{data.confirmationCode}</dd>
        </div>
      </dl>

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
          </div>
        ))}
        <p className="cb-ticket__amount">
          <strong>{data.totalAmount}円</strong>
          <br />
          お金は、ブースのレジで現金です
        </p>
      </div>
    </main>
  );
}
