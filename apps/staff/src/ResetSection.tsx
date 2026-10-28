import { RESET_CONFIRM_TEXT } from "@canbadge/shared";
import { Button, ConfirmDialog, TextField, useAction, useResource } from "@canbadge/ui";
import { useState } from "react";
import { api } from "./api";
import {
  blockerCopy,
  deletedLine,
  doneMessage,
  isResetConfirmed,
  unfinishedWarning,
} from "./reset-logic";

type Message = { tone: "info" | "error"; text: string };

/**
 * イベントデータのリセット（テストのあと・本番の前）。受付が終了しているときだけ押せる。
 * 取り消せないので、消える件数を見せ、確認の文字を打ち込ませる。消す前に、api がバックアップを取る
 */
export function ResetSection({
  onChanged,
  onMessage,
}: {
  onChanged: () => void;
  onMessage: (message: Message) => void;
}) {
  const summary = useResource(() => api.call("getResetSummary"), {
    subscribe: (reload) => api.subscribe("staffEvents", { onEvent: reload, onOpen: reload }),
  });
  const [asking, setAsking] = useState(false);
  const [typed, setTyped] = useState("");

  const close = () => {
    setAsking(false);
    setTyped("");
  };

  const reset = useAction(async () => {
    const result = await api.call("resetEventData", { body: { confirm: RESET_CONFIRM_TEXT } });
    close();
    summary.reload();
    onChanged();
    onMessage({ tone: "info", text: doneMessage(result) });
  });

  const data = summary.data;
  const blocker = data?.blockers[0];
  const warning = data ? unfinishedWarning(data.counts) : undefined;

  return (
    <div className="cb-settings__block cb-settings__danger">
      <h2>データのリセット</h2>
      <p className="cb-muted">
        テストの注文・売上・印刷の履歴・アーカイブを、まとめて消します。本番の前に、1
        回だけ使います。価格や上限などの設定は、残ります。
      </p>
      {data ? <p>{deletedLine(data.counts)}</p> : <p className="cb-muted">数えています…</p>}
      {summary.error && !data && <p className="cb-muted">{summary.error}</p>}
      {blocker && <p>{blockerCopy[blocker]}</p>}
      <Button
        size="large"
        block
        variant="line"
        onClick={() => setAsking(true)}
        disabled={!data || Boolean(blocker) || reset.running}
      >
        データをリセットする
      </Button>

      <ConfirmDialog
        open={asking}
        title="データをリセットしますか"
        confirmLabel="リセットする"
        running={reset.running}
        confirmDisabled={!isResetConfirmed(typed)}
        error={reset.error}
        onConfirm={() => void reset.run()}
        onCancel={close}
      >
        {data && <p>{deletedLine(data.counts)}</p>}
        {warning && (
          <p>
            <strong>{warning}</strong>
          </p>
        )}
        <p>
          残るもの：価格・上限・在庫の総数などの設定。残りの数は、注文を消すと、総数に戻ります。
        </p>
        <p>
          営業開始の前に戻ります。そのあと「営業を開始する」を押すと、注文番号は 1 から始まります。
        </p>
        <p>
          消す前に、データ置き場にバックアップを取ります。ただし、このボタンでは元に戻せません。
        </p>
        <TextField
          label={`確認のため、「${RESET_CONFIRM_TEXT}」と入力してください`}
          value={typed}
          autoComplete="off"
          onChange={(event) => setTyped(event.target.value)}
        />
      </ConfirmDialog>
    </div>
  );
}
