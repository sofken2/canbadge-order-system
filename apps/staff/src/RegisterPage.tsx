import { QrScanner } from "@canbadge/scanner";
import type { StaffOrderView } from "@canbadge/shared";
import { Button, Notice, TextField, useAction, useResource } from "@canbadge/ui";
import { useEffect, useRef, useState } from "react";
import { api } from "./api";
import {
  changeFor,
  notPayableMessage,
  parseRegisterInput,
  receivedChoices,
  secondsLeft,
} from "./register-logic";
import "./register.css";
import { UNDO_WINDOW_MS, usePendingPayment } from "./usePendingPayment";

/** 画面の上に出す、結果のお知らせ */
type Message = { tone: "info" | "error"; text: string };

const yen = (amount: number): string => `${amount.toLocaleString("ja-JP")}円`;

/** 現在時刻。取り消せる残り時間の表示を、0.25 秒おきに更新するため */
function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(timer);
  }, [active]);
  return now;
}

/**
 * レジ。QR の読み取りと注文番号の入力を、同じ入力として受け付け、確認（金額・お釣り）を経て、支払い済みにする。
 * 押し間違いに対応するため、支払い済みにしてから 5 秒間は、取り消せる（その間は、まだ確定しない）
 */
export function RegisterPage() {
  const [text, setText] = useState("");
  const [order, setOrder] = useState<StaffOrderView | undefined>(undefined);
  const [received, setReceived] = useState<number | undefined>(undefined);
  const [custom, setCustom] = useState("");
  const [message, setMessage] = useState<Message | undefined>(undefined);
  const inputRef = useRef<HTMLInputElement>(null);

  // 支払い待ちの注文の一覧。QR が読めないときに、番号を打たずに選べる。変わったら（SSE）読み直す
  const waiting = useResource(
    () => api.call("searchStaffOrders", { query: { status: "submitted", limit: 12 } }),
    {
      subscribe: (reload) => api.subscribe("staffEvents", { onEvent: reload, onOpen: reload }),
      refreshMs: 20000,
    },
  );

  const payment = usePendingPayment({
    commit: async (target) => {
      await api.call("payOrder", { params: { orderId: target.id } });
    },
    commitOnLeave: (target) => {
      // 画面を離れるときは、応答を待てない。keepalive で、送りきる
      void fetch(api.url("payOrder", { params: { orderId: target.id } }), {
        method: "POST",
        keepalive: true,
      });
    },
    onCommitted: (target, change) => {
      setMessage({
        tone: "info",
        text: `注文 ${target.orderNumberText} の支払いを受けました（${yen(target.totalAmount)}${
          change > 0 ? `・お釣り ${yen(change)}` : ""
        }）`,
      });
      waiting.reload();
    },
    onFailed: (target, reason) => {
      setMessage({
        tone: "error",
        text: `注文 ${target.orderNumberText} を支払い済みにできませんでした。${reason} もう一度、番号を入れて、確かめてください。`,
      });
      waiting.reload();
    },
  });
  const pending = payment.pending;
  const now = useNow(Boolean(pending));

  // ハンディスキャナー（キーボードのように入力する）を使う端末では、入力欄にすぐ入力できるようにする。
  // 指で操作する端末では、勝手にキーボードを出さない
  useEffect(() => {
    if (!order && window.matchMedia("(pointer: fine)").matches) inputRef.current?.focus();
  }, [order]);

  const lookup = useAction(async (raw: string) => {
    const input = parseRegisterInput(raw);
    if (input.kind === "empty") return;
    setMessage(undefined);
    if (input.kind === "invalid") {
      setMessage({
        tone: "error",
        text: `「${input.text}」は、注文番号でも、注文の QR でもありません。数字の注文番号を入れるか、お客さんの注文の QR を読み取ってください。`,
      });
      return;
    }
    const page = await api.call("searchStaffOrders", {
      // QR（注文 ID）は、状態を問わず探す（支払い済みの QR を読んだとき、そのことを伝えるため）。
      // 番号は、当日の支払い待ちの注文だけ
      query:
        input.kind === "order-id"
          ? { q: input.value, limit: 1 }
          : { q: input.value, status: "submitted", limit: 5 },
    });
    const found = page.items[0];
    if (!found) {
      setMessage({
        tone: "error",
        text:
          input.kind === "number"
            ? `注文番号 ${input.value} の、支払い待ちの注文が見つかりません。番号を確かめてください。`
            : "この QR の注文が見つかりません。お客さんの、注文状況の画面の QR か、確かめてください。",
      });
      return;
    }
    openOrder(found);
  });

  /** 確認の画面を開く（注文の検索結果・一覧の選択の、どちらからでも） */
  const openOrder = (target: StaffOrderView) => {
    if (pending?.order.id === target.id) {
      setMessage({
        tone: "info",
        text: `注文 ${target.orderNumberText} は、いま支払いの処理中です。取り消すこともできます。`,
      });
      return;
    }
    if (target.status !== "submitted") {
      setMessage({ tone: "error", text: notPayableMessage(target.status, target.orderNumberText) });
      return;
    }
    setOrder(target);
    setReceived(target.totalAmount);
    setCustom("");
    setText("");
    setMessage(undefined);
  };

  /** QR の読み取りも、番号の入力も、ここで受ける */
  const handleInput = (raw: string) => {
    if (!lookup.running) void lookup.run(raw);
  };

  const close = () => {
    setOrder(undefined);
    setReceived(undefined);
    setCustom("");
  };

  const confirmPayment = () => {
    if (!order) return;
    const { change } = changeFor(order.totalAmount, received ?? order.totalAmount);
    void payment.start(order, change);
    close();
  };

  const chooseCustom = (value: string) => {
    // 数字だけを受ける（全角も半角にする）
    const digits = value.normalize("NFKC").replace(/\D/g, "").slice(0, 7);
    setCustom(digits);
    setReceived(digits === "" ? undefined : Number(digits));
  };

  const amount = order ? (received ?? order.totalAmount) : 0;
  const { change, short } = order ? changeFor(order.totalAmount, amount) : { change: 0, short: 0 };
  const quantity = order?.items.reduce((sum, item) => sum + item.quantity, 0) ?? 0;

  return (
    <main className="cb-page cb-register">
      <h1>レジ</h1>

      {pending && (
        <section className="cb-register__pending" aria-label="取り消せる支払い" aria-live="polite">
          <p>
            注文 <strong>{pending.order.orderNumberText}</strong> を支払い済みにします
            {pending.change > 0 && <>（お釣り {yen(pending.change)}）</>}
          </p>
          <div className="cb-register__countdown" aria-hidden="true">
            <span
              key={pending.deadline}
              className="cb-register__countdown-bar"
              style={{ animationDuration: `${UNDO_WINDOW_MS}ms` }}
            />
          </div>
          <div className="cb-register__pending-actions">
            <Button variant="line" size="large" onClick={payment.undo}>
              取り消す（あと {secondsLeft(pending.deadline, now)} 秒）
            </Button>
            <Button variant="ink" onClick={() => void payment.flush()}>
              すぐ確定する
            </Button>
          </div>
        </section>
      )}

      {message && <Notice tone={message.tone}>{message.text}</Notice>}
      {lookup.error && <Notice tone="error">{lookup.error}</Notice>}

      {/* 確認の間も、カメラはつないだまま隠す（読み取りだけを止める）。次の注文で、すぐ読めるように */}
      <section hidden={Boolean(order)} aria-label="注文を探す">
        <QrScanner
          hideWhenUnavailable
          paused={Boolean(order) || lookup.running}
          onDetect={handleInput}
        />

        <form
          className="cb-register__form"
          onSubmit={(event) => {
            event.preventDefault();
            handleInput(text);
          }}
        >
          <TextField
            ref={inputRef}
            numeric
            label="注文番号"
            hint="QR を読むか、番号を入れます（ハンディスキャナーも、ここに入力されます）"
            value={text}
            inputMode="numeric"
            autoComplete="off"
            onChange={(event) => setText(event.target.value)}
          />
          <Button
            type="submit"
            variant="ink"
            size="large"
            block
            disabled={text.trim() === "" || lookup.running}
          >
            探す
          </Button>
        </form>

        <h2 className="cb-gap-top">支払い待ち</h2>
        {waiting.error && <Notice tone="error">{waiting.error}</Notice>}
        {waiting.data && waiting.data.items.length === 0 && (
          <p className="cb-muted">支払い待ちの注文は、ありません。</p>
        )}
        <ul className="cb-register__waiting">
          {waiting.data?.items.map((item) => (
            <li key={item.id}>
              <button
                type="button"
                className="cb-register__waiting-item"
                onClick={() => openOrder(item)}
              >
                <span className="cb-register__waiting-number">{item.orderNumberText}</span>
                <span>{yen(item.totalAmount)}</span>
              </button>
            </li>
          ))}
        </ul>
      </section>

      {order && (
        <section className="cb-register__confirm" aria-label="支払いの確認">
          <div className="cb-register__head">
            <div>
              <p className="cb-muted">注文番号</p>
              <p className="cb-number cb-number--medium">{order.orderNumberText}</p>
            </div>
            {order.items[0] && (
              <img
                src={order.items[0].thumbnailUrl}
                alt="注文したバッジのデザイン"
                className="cb-register__thumb"
              />
            )}
          </div>

          <dl className="cb-summary">
            <dt>個数</dt>
            <dd>{quantity} 個</dd>
            <dt>金額</dt>
            <dd>
              <strong>{yen(order.totalAmount)}</strong>
            </dd>
          </dl>

          <fieldset className="cb-register__received">
            <legend className="cb-field__label">受け取った金額</legend>
            <div className="cb-register__choices">
              <button
                type="button"
                aria-pressed={custom === "" && received === order.totalAmount}
                onClick={() => {
                  setCustom("");
                  setReceived(order.totalAmount);
                }}
              >
                ちょうど
              </button>
              {receivedChoices(order.totalAmount).map((bill) => (
                <button
                  key={bill}
                  type="button"
                  aria-pressed={custom === "" && received === bill}
                  onClick={() => {
                    setCustom("");
                    setReceived(bill);
                  }}
                >
                  {yen(bill)}
                </button>
              ))}
            </div>
            <details className="cb-register__custom" open={custom !== ""}>
              <summary>ほかの金額を入れる</summary>
              <TextField
                label="ほかの金額"
                inputMode="numeric"
                autoComplete="off"
                value={custom}
                onChange={(event) => chooseCustom(event.target.value)}
              />
            </details>
          </fieldset>

          <p className="cb-register__change" data-short={short > 0 || undefined} aria-live="polite">
            {short > 0 ? (
              <>
                あと <strong>{yen(short)}</strong> 足りません
              </>
            ) : (
              <>
                お釣り <strong>{yen(change)}</strong>
              </>
            )}
          </p>

          <Button size="large" block onClick={confirmPayment} disabled={short > 0}>
            支払い済みにする
          </Button>
          <Button variant="line" block onClick={close}>
            やめる
          </Button>
        </section>
      )}
    </main>
  );
}
