import { type Acceptance, acceptanceLabels, type Setting } from "@canbadge/shared";
import {
  Button,
  ConfirmDialog,
  Notice,
  StatusLabel,
  TextField,
  useAction,
  useResource,
} from "@canbadge/ui";
import { useEffect, useState } from "react";
import { api } from "./api";
import {
  closeImpact,
  type FormField,
  formChanged,
  formFromSetting,
  hourLabel,
  hourlyRows,
  type Impact,
  openDayImpact,
  parseSettingsForm,
  type SettingsForm,
  todayJst,
} from "./settings-logic";
import "./settings.css";

type Tab = "operate" | "sales" | "values";
type Message = { tone: "info" | "error"; text: string };

const yen = (amount: number): string => `${amount.toLocaleString("ja-JP")}円`;

const acceptanceTone = (acceptance: Acceptance) =>
  acceptance === "open" ? "done" : acceptance === "busy" ? "active" : "neutral";

/** 営業と受付の操作。営業開始・受付終了は取り消せないので、何が起きるかを見せてから実行する。ビジーは、ワンタップ */
function OperateTab({
  setting,
  onChanged,
  onMessage,
}: {
  setting: Setting;
  onChanged: () => void;
  onMessage: (message: Message) => void;
}) {
  const [asking, setAsking] = useState<"open" | "close" | undefined>(undefined);
  const [busyMessage, setBusyMessage] = useState("");

  // 支払い待ちの件数は、確認の画面に出す（期限切れになる数）
  const submitted = useResource(
    () => api.call("searchStaffOrders", { query: { status: "submitted", limit: 100 } }),
    {
      subscribe: (reload) => api.subscribe("staffEvents", { onEvent: reload, onOpen: reload }),
    },
  );
  const submittedCount = submitted.data?.items.length ?? 0;
  const submittedLabel = submitted.data?.nextBefore ? `${submittedCount}+` : String(submittedCount);

  const impact: Impact | undefined =
    asking === "open"
      ? openDayImpact({
          businessDate: setting.businessDate,
          today: todayJst(Date.now()),
          submittedCount,
        })
      : asking === "close"
        ? closeImpact(submittedCount)
        : undefined;

  const run = useAction(async (action: "open" | "close" | "busy" | "unbusy") => {
    if (action === "open") await api.call("openBusinessDay");
    if (action === "close") {
      await api.call("setAcceptance", { body: { acceptance: "closed" } });
    }
    if (action === "busy") {
      await api.call("setAcceptance", {
        body: { acceptance: "busy", busyMessage: busyMessage.trim() || null },
      });
    }
    if (action === "unbusy") await api.call("setAcceptance", { body: { acceptance: "open" } });
    setAsking(undefined);
    onChanged();
    submitted.reload();
    onMessage({
      tone: "info",
      text:
        action === "open"
          ? "営業を開始しました。受付中です"
          : action === "close"
            ? "受付を終了しました"
            : action === "busy"
              ? "ビジーにしました。新しい注文は、受け付けていません"
              : "ビジーを解除しました。受付中です",
    });
  });

  const printToggle = useAction(async () => {
    await api.call(setting.printPaused ? "resumePrintQueue" : "pausePrintQueue");
    onChanged();
  });

  const closed = setting.acceptance === "closed";
  const beforeOpening = setting.businessDate === null;

  return (
    <section aria-label="営業と受付の操作">
      <dl className="cb-summary cb-settings__state">
        <dt>営業日</dt>
        <dd>{setting.businessDate ?? "営業開始の前"}</dd>
        <dt>受付</dt>
        <dd>
          <StatusLabel
            label={acceptanceLabels[setting.acceptance]}
            tone={acceptanceTone(setting.acceptance)}
          />
        </dd>
        <dt>支払い待ち</dt>
        <dd>{submittedLabel} 件</dd>
        <dt>印刷</dt>
        <dd>{setting.printPaused ? "止めています" : "動いています"}</dd>
      </dl>

      {setting.acceptance === "busy" && setting.busyMessage && (
        <Notice>来場者への案内：{setting.busyMessage}</Notice>
      )}
      {run.error && !asking && <Notice tone="error">{run.error}</Notice>}

      {/* ビジー：混んだら、すぐ止められるよう、確認なしの 1 タップ */}
      {setting.acceptance === "busy" ? (
        <div className="cb-settings__block">
          <Button size="large" block onClick={() => void run.run("unbusy")} disabled={run.running}>
            ビジーを解除する
          </Button>
        </div>
      ) : (
        <div className="cb-settings__block">
          <TextField
            label="来場者への案内（省略できます）"
            hint="空にすると、「混雑のため、注文の受付を一時停止しています。」と出ます"
            value={busyMessage}
            maxLength={100}
            autoComplete="off"
            onChange={(event) => setBusyMessage(event.target.value)}
          />
          <Button
            size="large"
            block
            variant="ink"
            onClick={() => void run.run("busy")}
            disabled={run.running || setting.acceptance !== "open"}
          >
            ビジーにする（新しい注文を止める）
          </Button>
          <p className="cb-muted">支払い・印刷・受け渡しは、続けられます。</p>
        </div>
      )}

      <div className="cb-settings__block cb-settings__danger">
        <h2>営業の開始と終了</h2>
        <Button
          size="large"
          block
          variant={closed || beforeOpening ? "primary" : "line"}
          onClick={() => setAsking("open")}
          disabled={run.running}
        >
          {setting.businessDate === todayJst(Date.now()) ? "受付を再開する" : "営業を開始する"}
        </Button>
        <Button
          size="large"
          block
          variant="line"
          onClick={() => setAsking("close")}
          disabled={run.running || closed || beforeOpening}
        >
          受付を終了する
        </Button>
        <p className="cb-muted">どちらも取り消せません。押すと、先に、何が起きるかを確認します。</p>
      </div>

      <div className="cb-settings__block">
        <h2>印刷</h2>
        <Button
          variant={setting.printPaused ? "primary" : "line"}
          block
          onClick={() => void printToggle.run()}
          disabled={printToggle.running}
        >
          {setting.printPaused ? "印刷を再開する" : "印刷を止める"}
        </Button>
        {printToggle.error && <Notice tone="error">{printToggle.error}</Notice>}
      </div>

      <ConfirmDialog
        open={Boolean(impact)}
        title={impact?.title ?? ""}
        confirmLabel={impact?.confirmLabel ?? ""}
        running={run.running}
        error={run.error}
        onConfirm={() => void run.run(asking === "open" ? "open" : "close")}
        onCancel={() => setAsking(undefined)}
      >
        {impact?.lines.map((line) => (
          <p key={line}>{line}</p>
        ))}
      </ConfirmDialog>
    </section>
  );
}

/** 売上：レジの現金と照合する。返金を差し引いた額（差引）を、いちばん大きく出す */
function SalesTab({ businessDate }: { businessDate: string | null }) {
  const [date, setDate] = useState<string | undefined>(undefined);
  const sales = useResource(
    () => api.call("getSales", { query: date ? { businessDate: date } : {} }),
    {
      deps: [date],
      subscribe: (reload) => api.subscribe("staffEvents", { onEvent: reload, onOpen: reload }),
      refreshMs: 30000,
    },
  );

  if (sales.error && !sales.data) return <Notice tone="error">{sales.error}</Notice>;
  const data = sales.data;
  if (!data) return <p className="cb-muted">読み込み中…</p>;
  const { rows } = hourlyRows(data);
  const total = data.total;

  return (
    <section aria-label="売上">
      <TextField
        label="営業日"
        type="date"
        value={date ?? data.businessDate}
        max={businessDate ?? undefined}
        onChange={(event) => setDate(event.target.value || undefined)}
      />

      <p className="cb-settings__net-label">レジの現金と照合する額（返金を引いた額）</p>
      <p className="cb-settings__net" aria-live="polite">
        {yen(total.netAmount)}
      </p>

      <dl className="cb-summary">
        <dt>支払い済み</dt>
        <dd>
          {total.paidCount} 件・{yen(total.paidAmount)}
        </dd>
        <dt>返金</dt>
        <dd>
          {total.refundedCount} 件・{total.refundedCount > 0 ? "−" : ""}
          {yen(total.refundedAmount)}
        </dd>
      </dl>

      <h2>時間帯ごと</h2>
      {rows.length === 0 ? (
        <p className="cb-muted">この日の支払いは、まだありません。</p>
      ) : (
        <ul className="cb-settings__hours">
          {rows.map((row) => (
            <li key={row.hour}>
              <span className="cb-settings__hour">{hourLabel(row.hour)}</span>
              <span className="cb-settings__bar" aria-hidden="true">
                <span style={{ width: `${Math.round(row.ratio * 100)}%` }} />
              </span>
              <span className="cb-settings__hour-amount">
                {yen(row.paidAmount)}
                <small>{row.paidCount} 件</small>
              </span>
            </li>
          ))}
        </ul>
      )}
      <p className="cb-muted">支払った時刻（日本時間）で分けています。</p>
    </section>
  );
}

/** 価格・上限などの設定。保存すると、新しい注文から変わる（すでにある注文の金額は、そのまま） */
function ValuesTab({
  setting,
  onChanged,
  onMessage,
}: {
  setting: Setting;
  onChanged: () => void;
  onMessage: (message: Message) => void;
}) {
  const [form, setForm] = useState<SettingsForm>(() => formFromSetting(setting));
  const [errors, setErrors] = useState<Partial<Record<FormField, string>>>({});

  // 別の端末で保存されたとき（updatedAt が変わったとき）、編集中でなければ、入力欄を合わせる
  const [seenAt, setSeenAt] = useState(setting.updatedAt);
  useEffect(() => {
    if (setting.updatedAt === seenAt) return;
    setSeenAt(setting.updatedAt);
    setForm((current) => (formChanged(current, setting) ? current : formFromSetting(setting)));
  }, [setting, seenAt]);

  const save = useAction(async () => {
    const parsed = parseSettingsForm(form);
    if (!parsed.ok) {
      setErrors(parsed.errors);
      return;
    }
    setErrors({});
    const saved = await api.call("updateSettings", { body: parsed.value });
    setForm(formFromSetting(saved));
    onChanged();
    onMessage({ tone: "info", text: "保存しました。新しい注文から、この設定になります" });
  });

  const changed = formChanged(form, setting);
  const field = (name: FormField, label: string, hint: string, suffix?: string) => (
    <div className="cb-settings__field">
      <TextField
        label={label}
        hint={errors[name] ?? hint}
        value={form[name]}
        inputMode={name === "imageMaxMb" ? "decimal" : "numeric"}
        autoComplete="off"
        aria-invalid={errors[name] ? true : undefined}
        onChange={(event) => setForm({ ...form, [name]: event.target.value })}
      />
      {suffix && <span className="cb-settings__suffix">{suffix}</span>}
    </div>
  );

  return (
    <form
      aria-label="設定"
      onSubmit={(event) => {
        event.preventDefault();
        void save.run();
      }}
    >
      {field("price", "価格（1 個）", "すでにある注文の金額は、変わりません", "円")}
      {field(
        "maxQuantityPerOrder",
        "1 注文の個数の上限",
        "1 にすると、注文の画面に、個数の選択が出ません",
        "個",
      )}
      {field(
        "maxPendingPerDevice",
        "1 台あたりの、支払い待ちの上限",
        "同じスマホから出せる、支払い前の注文の数",
        "件",
      )}
      {field(
        "printMaxWaitSeconds",
        "印刷を待つ最大の秒数",
        "用紙 1 枚分たまらなくても、いちばん古い注文が、この秒数待ったら、印刷します",
        "秒",
      )}
      {field(
        "orderNumberDigits",
        "注文番号の桁数",
        "1〜6。3 なら 007 のように、0 で埋めます",
        "桁",
      )}
      {field("imageMaxMb", "画像の容量の上限", "お客さんが取り込める、写真 1 枚の大きさ", "MB")}

      {save.error && <Notice tone="error">{save.error}</Notice>}
      {Object.keys(errors).length > 0 && (
        <Notice tone="error">赤く示した欄を、直してから、もう一度、保存してください。</Notice>
      )}
      <Button type="submit" size="large" block disabled={!changed || save.running}>
        {changed ? "保存する" : "変更はありません"}
      </Button>
    </form>
  );
}

/**
 * 設定・売上集計。責任者が、当日の運用を画面から制御する。
 * 「受付」（営業開始・ビジー・受付終了・印刷）「売上」「設定」の 3 つ
 */
export function SettingsPage() {
  const [tab, setTab] = useState<Tab>("operate");
  const [message, setMessage] = useState<Message | undefined>(undefined);

  const setting = useResource(() => api.call("getSettings"), {
    subscribe: (reload) => api.subscribe("staffEvents", { onEvent: reload, onOpen: reload }),
  });

  if (setting.error && !setting.data) {
    return (
      <main className="cb-page">
        <Notice tone="error">{setting.error}</Notice>
      </main>
    );
  }
  const data = setting.data;
  if (!data) {
    return (
      <main className="cb-page">
        <p className="cb-muted">読み込み中…</p>
      </main>
    );
  }

  const pick = (next: Tab) => {
    setTab(next);
    setMessage(undefined);
  };

  return (
    <main className="cb-page cb-settings">
      <h1>設定・売上</h1>

      <div className="cb-switch" role="tablist" aria-label="設定の項目">
        {(
          [
            ["operate", "受付"],
            ["sales", "売上"],
            ["values", "設定"],
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
        {tab === "operate" && (
          <OperateTab setting={data} onChanged={setting.reload} onMessage={setMessage} />
        )}
        {tab === "sales" && <SalesTab businessDate={data.businessDate} />}
        {tab === "values" && (
          <ValuesTab setting={data} onChanged={setting.reload} onMessage={setMessage} />
        )}
      </div>
    </main>
  );
}
