import { acceptanceLabels } from "@canbadge/shared";
import { useAction, useResource } from "@canbadge/ui";
import { api } from "./api";

// 仮画面（T09）。価格・上限の変更、売上の集計（S07）は、設定・売上集計画面で作る。

/** 営業開始・受付状態・印刷の一時停止。注文の受付は、営業開始をしてからでないと始まらない */
export function SettingsPage() {
  const setting = useResource(() => api.call("getSettings"), {
    subscribe: (reload) => api.subscribe("staffEvents", { onEvent: reload, onOpen: reload }),
  });

  const act = useAction(async (action: () => Promise<unknown>) => {
    await action();
    setting.reload();
  });

  if (setting.error) return <p role="alert">{setting.error}</p>;
  const s = setting.data;
  if (!s) return <p>読み込み中…</p>;

  return (
    <main>
      <h1>設定（仮画面）</h1>
      <p>営業日：{s.businessDate ?? "（営業開始の前）"}</p>
      <p>受付：{acceptanceLabels[s.acceptance]}</p>
      <p>印刷：{s.printPaused ? "一時停止中" : "動作中"}</p>

      <p>
        <button
          type="button"
          onClick={() => void act.run(() => api.call("openBusinessDay"))}
          disabled={act.running}
        >
          営業開始
        </button>{" "}
        <button
          type="button"
          onClick={() =>
            void act.run(() => api.call("setAcceptance", { body: { acceptance: "busy" } }))
          }
          disabled={act.running}
        >
          ビジー（新規注文を止める）
        </button>{" "}
        <button
          type="button"
          onClick={() =>
            void act.run(() => api.call("setAcceptance", { body: { acceptance: "open" } }))
          }
          disabled={act.running}
        >
          ビジー解除
        </button>{" "}
        <button
          type="button"
          onClick={() =>
            void act.run(() => api.call("setAcceptance", { body: { acceptance: "closed" } }))
          }
          disabled={act.running}
        >
          受付終了
        </button>
      </p>
      <p>
        <button
          type="button"
          onClick={() =>
            void act.run(() => api.call(s.printPaused ? "resumePrintQueue" : "pausePrintQueue"))
          }
          disabled={act.running}
        >
          {s.printPaused ? "印刷を再開" : "印刷を一時停止"}
        </button>
      </p>
      {act.error && <p role="alert">{act.error}</p>}
    </main>
  );
}
