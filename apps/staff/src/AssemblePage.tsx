import { QrScanner } from "@canbadge/scanner";
import { kiraPatternLabels, orderStatusLabels, type StaffOrderView } from "@canbadge/shared";
import {
  Button,
  isCompleteCode,
  Notice,
  normalizeConfirmationCode,
  TextField,
  useAction,
  useResource,
} from "@canbadge/ui";
import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "./api";
import "./assemble.css";
import {
  groupOrders,
  LONG_WAIT_LABEL,
  minutesSince,
  notPickableMessage,
  readySinceLabel,
  urgencyOf,
} from "./assemble-logic";
import { parseRegisterInput } from "./register-logic";
import { useNow } from "./useNow";

type Tab = "assemble" | "pickup";
type Message = { tone: "info" | "error"; text: string };

const TAB_KEY = "canbadge-staff-assemble-tab";

/** 最後に開いたタブを覚える。組立係と受け渡し係が、別の端末で、毎回同じタブを開けるように（なくても動く） */
function loadTab(): Tab {
  try {
    return window.localStorage.getItem(TAB_KEY) === "pickup" ? "pickup" : "assemble";
  } catch {
    return "assemble";
  }
}

function saveTab(tab: Tab): void {
  try {
    window.localStorage.setItem(TAB_KEY, tab);
  } catch {
    // 保存できなくても、画面は動く
  }
}

/** 組み立て 1 件。操作は「完成」だけ（印刷が終わると、自動で組み立て中になる）。ボタンは、誤って押しにくいよう、カードの下端に、幅いっぱいで置く */
function AssembleCard({ order, onChanged }: { order: StaffOrderView; onChanged: () => void }) {
  const act = useAction(async () => {
    await api.call("completeOrder", { params: { orderId: order.id } });
    onChanged();
  });
  const quantity = order.items.reduce((sum, item) => sum + item.quantity, 0);
  const kiraQuantity = order.items.reduce((sum, item) => sum + item.kiraQuantity, 0);
  // どの柄を貼るか。取り違えると、お客さんの選んだ柄と変わる
  const kiraPatternText = order.items
    .flatMap((item) => (item.kiraQuantity > 0 && item.kiraPattern ? [item.kiraPattern] : []))
    .map((pattern) => kiraPatternLabels[pattern])
    .join("・");
  const magnetQuantity = order.items.reduce((sum, item) => sum + item.magnetQuantity, 0);
  const thumbnail = order.items[0]?.thumbnailUrl;

  return (
    <li className="cb-asm__card" data-status={order.status}>
      <div className="cb-asm__card-head">
        <p className="cb-number cb-number--medium">{order.orderNumberText}</p>
        <p className="cb-muted">{quantity} 個</p>
        {/* 貼り忘れると、お金をもらった分の品がそろわない。個数と並べて、はっきり見せる */}
        {kiraQuantity > 0 && (
          <p>
            <strong>
              キラフィルム {kiraQuantity} 個{kiraPatternText && `（${kiraPatternText}）`}
            </strong>
          </p>
        )}
        {magnetQuantity > 0 && (
          <p>
            <strong>マグネット加工 {magnetQuantity} 個</strong>
          </p>
        )}
        {thumbnail && <img src={thumbnail} alt="" className="cb-asm__thumb" />}
      </div>
      {/* カードが並ぶので、珊瑚の主ボタンにはしない（1 画面に 1 つまで）。黒地にして、主ボタンと混ざらないようにする */}
      <Button
        size="large"
        block
        variant="ink"
        disabled={act.running}
        onClick={() => void act.run()}
      >
        完成にする
      </Button>
      {act.error && <Notice tone="error">{act.error}</Notice>}
    </li>
  );
}

/** 受け渡し。確認コードを入れてもらい、照合は api に任せる（画面に、正解を持たせない） */
function PickupPanel({
  order,
  onClose,
  onDone,
}: {
  order: StaffOrderView;
  onClose: () => void;
  onDone: (order: StaffOrderView) => void;
}) {
  const [code, setCode] = useState("");
  const pickup = useAction(async () => {
    await api.call("pickupOrder", {
      params: { orderId: order.id },
      body: { confirmationCode: code },
    });
    onDone(order);
  });
  // 確認コードを見せられないお客さん向け。押し間違いを防ぐため、2 段階にする
  const [forcing, setForcing] = useState(false);
  const force = useAction(async () => {
    await api.call("forcePickupOrder", { params: { orderId: order.id } });
    onDone(order);
  });
  const thumbnail = order.items[0]?.thumbnailUrl;

  return (
    <section className="cb-asm__pickup" aria-label="受け渡し">
      <div className="cb-asm__card-head">
        <div>
          <p className="cb-muted">注文番号</p>
          <p className="cb-number cb-number--medium">{order.orderNumberText}</p>
        </div>
        {thumbnail && (
          <img src={thumbnail} alt="注文したバッジのデザイン" className="cb-asm__thumb" />
        )}
      </div>

      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (isCompleteCode(code)) void pickup.run();
        }}
      >
        <TextField
          numeric
          label="確認コード（4 文字）"
          hint="お客さんの、注文状況の画面に出ている 4 文字です。0・O・1・I・L は、使いません"
          value={code}
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          onChange={(event) => setCode(normalizeConfirmationCode(event.target.value))}
        />
        {pickup.error && (
          <Notice tone="error">
            {pickup.error} お客さんに、確認コードを、もう一度、見せてもらってください。
          </Notice>
        )}
        <Button type="submit" size="large" block disabled={!isCompleteCode(code) || pickup.running}>
          受け渡し済みにする
        </Button>
      </form>
      {forcing ? (
        <div className="cb-asm__force">
          <Notice tone="error">
            確認コードを照合せずに、注文 {order.orderNumberText}{" "}
            を受け渡し済みにします。お客さんの注文であることを、注文番号やデザインで確かめてから押してください。取り消せません（操作ログには残ります）。
          </Notice>
          {force.error && <Notice tone="error">{force.error}</Notice>}
          <Button block size="large" onClick={() => void force.run()} disabled={force.running}>
            強制的に受け渡し済みにする
          </Button>
          <Button variant="line" block onClick={() => setForcing(false)} disabled={force.running}>
            戻る
          </Button>
        </div>
      ) : (
        <Button variant="line" block onClick={() => setForcing(true)} disabled={pickup.running}>
          確認コードが分からない（強制受け渡し）
        </Button>
      )}
      <Button variant="line" block onClick={onClose} disabled={pickup.running || force.running}>
        やめる
      </Button>
    </section>
  );
}

/**
 * 組み立て・受け渡し。
 * 組み立て：印刷が終わった注文（自動で組み立て中になる）を、順に「完成にする」と進める。
 * 受け渡し：QR か番号で注文を探し（できあがりの一覧からも選べる）、確認コードを照合して渡す。長く待っている注文は、目立たせる
 */
export function AssemblePage() {
  const [tab, setTabState] = useState<Tab>(loadTab);
  const [message, setMessage] = useState<Message | undefined>(undefined);
  const [target, setTarget] = useState<StaffOrderView | undefined>(undefined);
  const [text, setText] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const now = useNow(30000);

  const orders = useResource(
    () => api.call("searchStaffOrders", { query: { status: "assembling,ready", limit: 100 } }),
    { subscribe: (reload) => api.subscribe("staffEvents", { onEvent: reload, onOpen: reload }) },
  );
  const grouped = useMemo(() => groupOrders(orders.data?.items ?? []), [orders.data]);
  const longWaiting = grouped.ready.filter(
    (order) => urgencyOf(minutesSince(order.readyAt, now)) !== "normal",
  ).length;

  const setTab = (next: Tab) => {
    setTabState(next);
    saveTab(next);
    setMessage(undefined);
  };

  // ハンディスキャナーを使う端末では、入力欄にすぐ入力できるようにする（指で操作する端末では、キーボードを出さない）
  useEffect(() => {
    if (tab === "pickup" && !target && window.matchMedia("(pointer: fine)").matches) {
      inputRef.current?.focus();
    }
  }, [tab, target]);

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
    // 状態を問わず探して、受け渡せないときは、その理由を伝える
    const page = await api.call("searchStaffOrders", { query: { q: input.value, limit: 5 } });
    const found = page.items[0];
    if (!found) {
      setMessage({
        tone: "error",
        text:
          input.kind === "number"
            ? `注文番号 ${input.value} の注文が見つかりません。番号を確かめてください。`
            : "この QR の注文が見つかりません。お客さんの、注文状況の画面の QR か、確かめてください。",
      });
      return;
    }
    openPickup(found);
  });

  const openPickup = (order: StaffOrderView) => {
    if (order.status !== "ready") {
      setMessage({ tone: "error", text: notPickableMessage(order.status, order.orderNumberText) });
      return;
    }
    setTarget(order);
    setText("");
    setMessage(undefined);
  };

  const handleInput = (raw: string) => {
    if (!lookup.running) void lookup.run(raw);
  };

  if (orders.error && !orders.data) {
    return (
      <main className="cb-page">
        <Notice tone="error">{orders.error}</Notice>
      </main>
    );
  }

  const assembleCount = grouped.assembling.length;

  return (
    <main className="cb-page cb-asm">
      <h1>組み立て・受け渡し</h1>

      <div className="cb-switch" role="tablist" aria-label="作業">
        <button
          type="button"
          role="tab"
          aria-selected={tab === "assemble"}
          onClick={() => setTab("assemble")}
        >
          組み立て <span className="cb-switch__count">{assembleCount}</span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "pickup"}
          onClick={() => setTab("pickup")}
        >
          受け渡し <span className="cb-switch__count">{grouped.ready.length}</span>
          {longWaiting > 0 && (
            <span className="cb-flag cb-switch__flag">
              {LONG_WAIT_LABEL} {longWaiting} 件
            </span>
          )}
        </button>
      </div>

      {message && <Notice tone={message.tone}>{message.text}</Notice>}
      {lookup.error && <Notice tone="error">{lookup.error}</Notice>}

      {tab === "assemble" && (
        <div role="tabpanel">
          {assembleCount === 0 && (
            <p className="cb-muted">組み立てる注文はありません。印刷が済むと、ここに出ます。</p>
          )}
          {grouped.assembling.length > 0 && (
            <>
              <h2>組み立て中（{grouped.assembling.length}）</h2>
              <ul className="cb-asm__list">
                {grouped.assembling.map((order) => (
                  <AssembleCard key={order.id} order={order} onChanged={orders.reload} />
                ))}
              </ul>
            </>
          )}
        </div>
      )}

      {tab === "pickup" && (
        <div role="tabpanel">
          {/* 受け渡しの間も、カメラはつないだまま隠す（読み取りだけを止める） */}
          <section hidden={Boolean(target)} aria-label="受け渡す注文を探す">
            <QrScanner
              hideWhenUnavailable
              paused={Boolean(target) || lookup.running}
              onDetect={handleInput}
            />
            <form
              className="cb-asm__form"
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

            <h2 className="cb-gap-top">
              {orderStatusLabels.ready}（{grouped.ready.length}）
            </h2>
            {grouped.ready.length === 0 && (
              <p className="cb-muted">{orderStatusLabels.ready}の注文はありません。</p>
            )}
            <ul className="cb-asm__ready">
              {grouped.ready.map((order) => {
                const minutes = minutesSince(order.readyAt, now);
                const urgency = urgencyOf(minutes);
                return (
                  <li key={order.id}>
                    <button
                      type="button"
                      className="cb-asm__ready-item"
                      data-urgency={urgency}
                      onClick={() => openPickup(order)}
                    >
                      <span className="cb-asm__ready-number">{order.orderNumberText}</span>
                      <span className="cb-asm__ready-wait">
                        {minutes === undefined ? "" : readySinceLabel(minutes)}
                      </span>
                      {urgency !== "normal" && <span className="cb-flag">{LONG_WAIT_LABEL}</span>}
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>

          {target && (
            <PickupPanel
              order={target}
              onClose={() => setTarget(undefined)}
              onDone={(done) => {
                setTarget(undefined);
                setMessage({
                  tone: "info",
                  text: `注文 ${done.orderNumberText} をお渡ししました。`,
                });
                orders.reload();
              }}
            />
          )}
        </div>
      )}
    </main>
  );
}
