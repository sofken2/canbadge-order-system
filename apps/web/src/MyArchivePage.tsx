import type { MyArchiveEntryView } from "@canbadge/shared";
import { Button, ConfirmDialog, Notice, navigate, useAction, useResource } from "@canbadge/ui";
import { useState } from "react";
import { api } from "./api";
import "./archive.css";
import {
  canWithdraw,
  myEntryStatus,
  postedMessage,
  withdrawConfirmMessage,
} from "./archive-post-logic";

/** 状態が変わったあとも、一覧を取り直す間隔。スタッフが審査すると、「審査待ち」が「公開中」に変わる */
const REFRESH_MS = 15_000;

function EntryCard({ entry, onChanged }: { entry: MyArchiveEntryView; onChanged: () => void }) {
  const [confirming, setConfirming] = useState(false);
  const withdraw = useAction(async () => {
    await api.call("withdrawArchiveEntry", { params: { entryId: entry.id } });
    setConfirming(false);
    onChanged();
  });
  const info = myEntryStatus[entry.status];

  return (
    <li className="cb-mine__card" data-status={entry.status}>
      <img src={entry.thumbnailUrl} alt="" className="cb-mine__thumb" />
      <div className="cb-mine__body">
        <p className="cb-mine__name">{entry.displayName}</p>
        {/* 状態は、色だけでなく、文字で伝える */}
        <p className="cb-mine__status">{info.label}</p>
        <p className="cb-muted">{info.note}</p>
        {canWithdraw(entry.status) && (
          <Button variant="line" onClick={() => setConfirming(true)}>
            取り下げる
          </Button>
        )}
      </div>
      {canWithdraw(entry.status) && (
        <ConfirmDialog
          open={confirming}
          title="この作品を、取り下げますか？"
          confirmLabel="取り下げる"
          running={withdraw.running}
          error={withdraw.error}
          onConfirm={() => void withdraw.run()}
          onCancel={() => setConfirming(false)}
        >
          {withdrawConfirmMessage(entry.displayName)}
        </ConfirmDialog>
      )}
    </li>
  );
}

/**
 * 自分が投稿した作品（W06）。この端末（匿名トークンの Cookie）で投稿したものだけが出る。
 * 公開中の作品は、ここから取り下げられる
 */
export function MyArchivePage() {
  const mine = useResource(() => api.call("listMyArchive"), { refreshMs: REFRESH_MS });
  const posted = new URLSearchParams(window.location.search).get("posted") === "1";
  const items = mine.data?.items ?? [];

  return (
    <main className="cb-page">
      <h1>自分の投稿</h1>
      {posted && <Notice tone="info">{postedMessage}</Notice>}
      <p className="cb-muted">
        この端末で投稿した作品です。端末を変えたり、ブラウザのデータを消したりすると、ここには出なくなります。
      </p>
      {mine.error && <Notice tone="error">{mine.error}</Notice>}

      {mine.data && items.length === 0 && (
        <p className="cb-muted">この端末で投稿した作品は、ありません。</p>
      )}
      <ul className="cb-mine__list">
        {items.map((entry) => (
          <EntryCard key={entry.id} entry={entry} onChanged={mine.reload} />
        ))}
      </ul>

      <Button block size="large" onClick={() => navigate("/archive/post")}>
        作品を、投稿する
      </Button>
      <Button variant="line" block onClick={() => navigate("/")}>
        バッジを注文する
      </Button>
    </main>
  );
}
