import {
  type OrderStatus,
  orderStatusLabels,
  type PrintedItemView,
  type PrintSheetStatus,
  printSheetStatusLabels,
  printSlotResultLabels,
} from "@canbadge/shared";
import {
  Button,
  ConfirmDialog,
  Notice,
  StatusLabel,
  type StatusTone,
  TextField,
  useAction,
  useResource,
} from "@canbadge/ui";
import { useMemo, useState } from "react";
import { api } from "./api";
import {
  isReprintableOrderStatus,
  type ReprintTarget,
  reprintImpact,
  reprintResultMessage,
  splitReprintable,
  toggled,
} from "./print-logic";
import { QueuePanel } from "./QueuePanel";
import "./print.css";

type Tab = "items" | "sheets";
type Message = { tone: "info" | "error"; text: string };

const time = (iso: string): string =>
  new Date(iso).toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" });

/** 状態の丸い印。進行中は珊瑚、済んだものは緑、止まったもの（期限切れ・失敗など）は灰 */
const orderTone = (status: OrderStatus): StatusTone =>
  status === "ready" || status === "picked_up"
    ? "done"
    : status === "expired" || status === "cancelled" || status === "refunded"
      ? "neutral"
      : "active";

const sheetTone = (status: PrintSheetStatus): StatusTone =>
  status === "printing" ? "active" : status === "confirmed" ? "done" : "neutral";

/** 再印刷の前の確認と、実行。バッジ一覧からも、シートの履歴からも、同じ流れで使う */
function useReprint(onDone: (message: Message) => void) {
  const [targets, setTargets] = useState<readonly ReprintTarget[] | undefined>(undefined);
  const [excludedCount, setExcludedCount] = useState(0);

  const run = useAction(async () => {
    if (!targets) return;
    const result = await api.call("reprint", {
      body: { orderItemIds: targets.map((target) => target.orderItemId) },
    });
    setTargets(undefined);
    onDone({ tone: "info", text: reprintResultMessage(result) });
  });

  const dialog = (
    <ConfirmDialog
      open={Boolean(targets)}
      title={`${targets?.length ?? 0} 個のバッジを再印刷します`}
      confirmLabel="再印刷にする"
      running={run.running}
      error={run.error}
      onConfirm={() => void run.run()}
      onCancel={() => setTargets(undefined)}
    >
      {targets && (
        <>
          <p>
            次の注文のバッジを、印刷待ちに戻します。印刷待ちのバッジと一緒に、次のシートで印刷します（用紙を無駄にしないよう、少し待つことがあります）。
          </p>
          <ul className="cb-print__impact">
            {reprintImpact(targets).map((line) => (
              <li key={line.status}>
                <strong className="cb-print__numbers">{line.numbers.join("・")}</strong>
                <span>{line.text}</span>
              </li>
            ))}
          </ul>
          {excludedCount > 0 && (
            <p className="cb-muted">
              受け渡し済みなどで再印刷できない {excludedCount} 個は、除いています。
            </p>
          )}
        </>
      )}
    </ConfirmDialog>
  );

  return {
    /** 再印刷できないものを外して、確認を開く。できるものがなければ、開かず false */
    ask: (all: readonly ReprintTarget[]): boolean => {
      const { reprintable, excluded } = splitReprintable(all);
      if (reprintable.length === 0) {
        onDone({
          tone: "error",
          text: "選んだバッジは、再印刷できません。まだ印刷待ち・印刷中か、受け渡し済み・取り消しなどの注文です。",
        });
        return false;
      }
      setExcludedCount(excluded.length);
      setTargets(reprintable);
      return true;
    },
    dialog,
  };
}

/** バッジ：印刷済みのバッジを、注文番号で探し、選んで再印刷に回す */
function ItemsTab({ onMessage }: { onMessage: (message: Message) => void }) {
  const [query, setQuery] = useState("");
  const [applied, setApplied] = useState("");
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());

  const items = useResource(
    () =>
      api.call("listPrintedItems", { query: { ...(applied ? { q: applied } : {}), limit: 100 } }),
    {
      deps: [applied],
      subscribe: (reload) => api.subscribe("staffEvents", { onEvent: reload, onOpen: reload }),
    },
  );
  const reprint = useReprint((message) => {
    setSelected(new Set());
    items.reload();
    onMessage(message);
  });

  const list = items.data?.items ?? [];
  const chosen = list.filter((item) => selected.has(item.orderItemId));
  const toTarget = (item: PrintedItemView): ReprintTarget => item;

  return (
    <section aria-label="印刷済みのバッジ">
      <form
        className="cb-print__search"
        onSubmit={(event) => {
          event.preventDefault();
          setApplied(query.trim());
          setSelected(new Set());
        }}
      >
        {/* レジ・受け渡しの番号の入力と、同じ形にそろえる（大きな下線の入力欄と、幅いっぱいのボタン） */}
        <TextField
          numeric
          label="注文番号"
          hint="空のまま探すと、新しい順にすべて出ます"
          value={query}
          inputMode="numeric"
          autoComplete="off"
          onChange={(event) => setQuery(event.target.value)}
        />
        <Button type="submit" variant="ink" size="large" block>
          探す
        </Button>
      </form>

      {items.error && <Notice tone="error">{items.error}</Notice>}
      {items.data && list.length === 0 && (
        <p className="cb-muted">
          {applied
            ? `「${applied}」の印刷済みのバッジはありません。`
            : "印刷済みのバッジはまだありません。"}
        </p>
      )}

      <ul className="cb-print__list">
        {list.map((item) => {
          const can = item.reprintable && isReprintableOrderStatus(item.orderStatus);
          const checked = selected.has(item.orderItemId);
          return (
            <li
              key={item.orderItemId}
              className="cb-print__row"
              data-selected={checked || undefined}
            >
              <label className="cb-print__pick">
                <input
                  type="checkbox"
                  checked={checked}
                  disabled={!can}
                  onChange={() => setSelected(toggled(selected, item.orderItemId))}
                />
                <img src={item.thumbnailUrl} alt="" className="cb-print__thumb" />
                <span className="cb-number cb-number--medium">{item.orderNumberText}</span>
                <span className="cb-print__meta">
                  <StatusLabel
                    label={orderStatusLabels[item.orderStatus]}
                    tone={orderTone(item.orderStatus)}
                  />
                  {/* 区切りは「・」の文字ではなく間隔で。狭い幅で「・」だけが行に残らないように */}
                  <span className="cb-print__facts cb-muted">
                    <span>{time(item.lastPrintedAt)}</span>
                    <span>{item.printCount} 回印刷</span>
                    {!can && <span>再印刷できません</span>}
                  </span>
                </span>
              </label>
            </li>
          );
        })}
      </ul>
      {items.data?.nextBefore && (
        <p className="cb-muted">
          新しい 100 個だけを出しています。古いものは、注文番号で探してください。
        </p>
      )}

      {chosen.length > 0 && (
        <div className="cb-print__bar">
          <span>{chosen.length} 個を選んでいます</span>
          <Button size="large" onClick={() => reprint.ask(chosen.map(toTarget))}>
            再印刷にする
          </Button>
        </div>
      )}
      {reprint.dialog}
    </section>
  );
}

/** シート：印刷したシートの履歴。シートごとに、PDF を見て、載っていたバッジを、まとめて再印刷に回す */
function SheetsTab({ onMessage }: { onMessage: (message: Message) => void }) {
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const sheets = useResource(() => api.call("listPrintSheets", { query: { limit: 100 } }), {
    subscribe: (reload) => api.subscribe("staffEvents", { onEvent: reload, onOpen: reload }),
  });
  const reprint = useReprint((message) => {
    setSelected(new Set());
    sheets.reload();
    onMessage(message);
  });

  const list = sheets.data?.items ?? [];
  const chosenItems = useMemo(
    () =>
      list
        .filter((sheet) => selected.has(sheet.id))
        .flatMap((sheet) => sheet.slots)
        // 同じバッジが、再印刷を重ねて、複数のシートに載ることがある（1 つにまとめる）
        .filter(
          (slot, index, all) => all.findIndex((s) => s.orderItemId === slot.orderItemId) === index,
        ),
    [list, selected],
  );

  return (
    <section aria-label="印刷したシートの履歴">
      {sheets.error && <Notice tone="error">{sheets.error}</Notice>}
      {sheets.data && list.length === 0 && (
        <p className="cb-muted">印刷したシートはまだありません。</p>
      )}

      <ul className="cb-print__list">
        {list.map((sheet) => {
          const checked = selected.has(sheet.id);
          return (
            <li key={sheet.id} className="cb-print__sheet" data-selected={checked || undefined}>
              <div className="cb-print__sheet-top">
                <label className="cb-print__pick">
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => setSelected(toggled(selected, sheet.id))}
                  />
                  <span className="cb-print__facts">
                    <span>
                      <strong>{time(sheet.printedAt)}</strong> に印刷
                    </span>
                    <StatusLabel
                      label={printSheetStatusLabels[sheet.status]}
                      tone={sheetTone(sheet.status)}
                    />
                    <span>{sheet.slots.length} 個</span>
                  </span>
                </label>
                <a
                  className="cb-print__pdf"
                  href={api.url("getPrintSheetPdf", { params: { sheetId: sheet.id } })}
                  target="_blank"
                  rel="noreferrer"
                >
                  PDF を開く
                </a>
              </div>
              <ol className="cb-print__mini">
                {[...sheet.slots]
                  .sort((a, b) => a.position - b.position)
                  .map((slot) => (
                    <li key={slot.orderItemId} data-result={slot.result}>
                      <img src={slot.thumbnailUrl} alt="" />
                      <span>{slot.orderNumberText}</span>
                      <small>{printSlotResultLabels[slot.result]}</small>
                    </li>
                  ))}
              </ol>
            </li>
          );
        })}
      </ul>
      {sheets.data?.nextBefore && <p className="cb-muted">新しい 100 枚だけを出しています。</p>}

      {chosenItems.length > 0 && (
        <div className="cb-print__bar">
          <span>
            {selected.size} 枚のシート（{chosenItems.length} 個）
          </span>
          <Button size="large" onClick={() => reprint.ask(chosenItems)}>
            まとめて再印刷にする
          </Button>
        </div>
      )}
      {reprint.dialog}
    </section>
  );
}

/**
 * 印刷。「バッジ」「シート」の 2 つ。印刷の確認の操作はない（印刷が終わると、注文は自動で組み立て中になる）。
 * 足りないバッジは、ここから、バッジごとに、すぐ再印刷できる。
 * 再印刷は、注文の状態が戻る（組み立て中・完成も印刷待ちに戻る）ので、実行の前に、対象の番号と影響を見せる。
 * 印刷の一時停止・再開は、どのタブからでも押せる（プリンターの失敗で、自動で止まったときも、ここで再開する）
 */
export function PrintPage() {
  const [tab, setTab] = useState<Tab>("items");
  const [message, setMessage] = useState<Message | undefined>(undefined);

  const settings = useResource(() => api.call("getSettings"), {
    subscribe: (reload) => api.subscribe("staffEvents", { onEvent: reload, onOpen: reload }),
  });
  const paused = settings.data?.printPaused ?? false;
  const toggle = useAction(async () => {
    await api.call(paused ? "resumePrintQueue" : "pausePrintQueue");
    settings.reload();
  });

  const pick = (next: Tab) => {
    setTab(next);
    setMessage(undefined);
  };

  return (
    <main className="cb-page cb-print">
      <h1>印刷</h1>

      <div className="cb-print__pause" data-paused={paused || undefined}>
        <p>
          {paused
            ? "印刷を止めています。新しいシートは、印刷されません（プリンターの失敗で、自動で止まることもあります）"
            : "印刷は動いています"}
        </p>
        {/* 珊瑚の主ボタンは、タブの中の確定の操作に譲る（1 画面に 1 つまで）。止めているときは黒地で目立たせる */}
        <Button
          size="large"
          variant={paused ? "ink" : "line"}
          onClick={() => void toggle.run()}
          disabled={toggle.running || !settings.data}
        >
          {paused ? "印刷を再開する" : "印刷を止める"}
        </Button>
      </div>
      {toggle.error && <Notice tone="error">{toggle.error}</Notice>}

      {/* 印刷待ち：支払い済みで、まだ印刷されていないバッジ。どのタブにいても、見える */}
      <QueuePanel paused={paused} waitSeconds={settings.data?.printMaxWaitSeconds ?? 120} />

      <div className="cb-switch" role="tablist" aria-label="印刷の作業">
        {(
          [
            ["items", "バッジ"],
            ["sheets", "シート"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            onClick={() => pick(id)}
          >
            {label}
          </button>
        ))}
      </div>

      {message && <Notice tone={message.tone}>{message.text}</Notice>}

      <div role="tabpanel">
        {tab === "items" && <ItemsTab onMessage={setMessage} />}
        {tab === "sheets" && <SheetsTab onMessage={setMessage} />}
      </div>
    </main>
  );
}
