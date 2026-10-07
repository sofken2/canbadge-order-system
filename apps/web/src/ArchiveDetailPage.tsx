import { badgeSpec } from "@canbadge/badge-spec";
import { OutputPreview } from "@canbadge/editor";
import {
  Button,
  ConfirmDialog,
  Notice,
  navigate,
  TextField,
  useAction,
  useResource,
} from "@canbadge/ui";
import { useState } from "react";
import { ArchiveOrderPanel } from "./ArchiveOrderPanel";
import { api } from "./api";
import "./archive.css";
import { myEntryStatus } from "./archive-post-logic";
import {
  authorLine,
  entryNotFoundMessage,
  REPORT_REASON_MAX,
  reportedMessage,
  reportProblem,
} from "./archive-view-logic";

/** 通報の入力。公開中の作品だけに出す。理由を書いて、スタッフに知らせる */
function ReportForm({ entryId }: { entryId: string }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [sent, setSent] = useState(false);
  // 理由が空のまま「通報する」を押したときに、押した直後から、理由を出す（最初から、赤い文字を出さない）
  const [touched, setTouched] = useState(false);
  const report = useAction(async () => {
    await api.call("reportArchiveEntry", { params: { entryId }, body: { reason: reason.trim() } });
    setOpen(false);
    setSent(true);
  });
  const problem = reportProblem(reason);

  if (sent) return <Notice tone="info">{reportedMessage}</Notice>;
  return (
    <>
      <Button variant="line" block onClick={() => setOpen(true)}>
        この作品を、通報する
      </Button>
      <ConfirmDialog
        open={open}
        title="この作品を、通報しますか？"
        confirmLabel="通報する"
        running={report.running}
        error={report.error ?? (touched ? problem : undefined)}
        onConfirm={() => {
          setTouched(true);
          if (!problem) void report.run();
        }}
        onCancel={() => {
          setOpen(false);
          setTouched(false);
        }}
      >
        <p>他の人の絵や写真を、使っているように見えるときなどに、スタッフに知らせてください。</p>
        <TextField
          label="どこが問題ですか"
          hint={`${REPORT_REASON_MAX} 文字まで`}
          value={reason}
          maxLength={REPORT_REASON_MAX}
          autoComplete="off"
          onChange={(event) => setReason(event.target.value)}
        />
      </ConfirmDialog>
    </>
  );
}

/**
 * 作品の詳細（W05）。大きい画像（仕上がりのプレビュー）と、作者の表示名。
 * 公開中の作品には、「この作品で注文する」（W07）と、通報の入口がある
 */
export function ArchiveDetailPage({ entryId }: { entryId: string }) {
  const entry = useResource(() => api.call("getArchiveEntry", { params: { entryId } }), {
    deps: [entryId],
  });
  const data = entry.data;
  // 見つからない（404）は、エラー表示ではなく、案内にする（取り下げられた作品を、開いたとき）
  const notFound = entry.error?.includes("見つかりません") === true;

  return (
    <main className="cb-page">
      <p>
        <a
          href="/archive"
          onClick={(event) => {
            event.preventDefault();
            navigate("/archive");
          }}
        >
          ← みんなの作品に戻る
        </a>
      </p>

      {notFound && (
        <>
          <h1>作品が見つかりません</h1>
          <p className="cb-muted">{entryNotFoundMessage}</p>
        </>
      )}
      {entry.error && !notFound && <Notice tone="error">{entry.error}</Notice>}
      {entry.loading && !data && !entry.error && <p className="cb-muted">読み込んでいます…</p>}

      {data && (
        <>
          <h1>{authorLine(data.displayName)}</h1>
          <OutputPreview src={data.imageUrl} spec={badgeSpec} />

          {data.isMine && (
            <Notice tone="info">
              あなたが投稿した作品です（{myEntryStatus[data.status].label}）。
              <a
                href="/archive/mine"
                onClick={(event) => {
                  event.preventDefault();
                  navigate("/archive/mine");
                }}
              >
                自分の投稿
              </a>
              から、取り下げられます。
            </Notice>
          )}

          {/* 公開中の作品だけ、注文できる（自分の作品も、注文できる） */}
          {data.status === "public" && (
            <ArchiveOrderPanel entryId={data.id} entryStatus={data.status} />
          )}

          {data.status === "public" && !data.isMine && (
            <div className="cb-gap-top">
              <ReportForm entryId={data.id} />
            </div>
          )}
        </>
      )}
    </main>
  );
}
