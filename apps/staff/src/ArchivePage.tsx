import type { ReportView, StaffArchiveEntryView } from "@canbadge/shared";
import { Button, ConfirmDialog, Notice, useAction, useResource } from "@canbadge/ui";
import { useMemo, useState } from "react";
import { api } from "./api";
import "./archive.css";
import {
  type ArchiveTab,
  archiveTabLabels,
  hideConfirmMessage,
  isLongPending,
  orderForReview,
  reportHeadline,
  statusText,
  tabStatuses,
  waitedLabel,
} from "./archive-logic";
import { useNow } from "./useNow";

/** 状態が変わったあとも、一覧を取り直す間隔。SSE の種類は、足していない（契約を変えないため）ので、定期的に読む */
const REFRESH_MS = 10_000;

const TABS: ArchiveTab[] = ["pending", "public", "reports", "closed"];

/** タブの作品を読む。「却下・非公開」は、2 つの状態を合わせて、新しい順にする */
async function loadEntries(tab: Exclude<ArchiveTab, "reports">): Promise<StaffArchiveEntryView[]> {
  const pages = await Promise.all(
    tabStatuses[tab].map((status) =>
      api.call("listStaffArchive", { query: { status, limit: 100 } }),
    ),
  );
  return pages.flatMap((page) => page.items).sort((a, b) => (a.id < b.id ? 1 : -1));
}

/** 画像の大きさを見て、権利面を判断するための、大きい画像と、操作 */
function EntryCard({
  entry,
  now,
  onChanged,
}: {
  entry: StaffArchiveEntryView;
  now: number;
  onChanged: () => void;
}) {
  const [confirmingHide, setConfirmingHide] = useState(false);
  const review = useAction(async (action: "approveArchiveEntry" | "rejectArchiveEntry") => {
    await api.call(action, { params: { entryId: entry.id } });
    onChanged();
  });
  const hide = useAction(async () => {
    await api.call("hideArchiveEntry", { params: { entryId: entry.id } });
    setConfirmingHide(false);
    onChanged();
  });
  const long = isLongPending(entry, now);

  return (
    <li className="cb-arc__card" data-status={entry.status} data-long={long || undefined}>
      <img
        src={entry.imageUrl}
        alt={`「${entry.displayName}」さんの作品`}
        className="cb-arc__image"
      />
      <div className="cb-arc__body">
        <p className="cb-arc__name">{entry.displayName}</p>
        <p className="cb-muted">
          <span className="cb-arc__status">{statusText[entry.status]}</span>
          {" ・ "}
          {waitedLabel(entry.createdAt, now)}に投稿
          {long && <strong className="cb-arc__flag">　長く待っています</strong>}
        </p>
        {entry.openReportCount > 0 && (
          <p className="cb-arc__reports">未対応の通報 {entry.openReportCount} 件</p>
        )}

        {entry.status === "pending_review" && (
          <div className="cb-arc__actions">
            <Button
              size="large"
              disabled={review.running}
              onClick={() => void review.run("approveArchiveEntry")}
            >
              承認して公開
            </Button>
            <Button
              size="large"
              variant="ink"
              disabled={review.running}
              onClick={() => void review.run("rejectArchiveEntry")}
            >
              却下
            </Button>
          </div>
        )}
        {entry.status === "public" && (
          <div className="cb-arc__actions">
            <Button size="large" variant="line" onClick={() => setConfirmingHide(true)}>
              非公開にする
            </Button>
          </div>
        )}
        {review.error && <Notice tone="error">{review.error}</Notice>}
      </div>

      {entry.status === "public" && (
        <ConfirmDialog
          open={confirmingHide}
          title="この作品を、非公開にしますか？"
          confirmLabel="非公開にする"
          running={hide.running}
          error={hide.error}
          onConfirm={() => void hide.run()}
          onCancel={() => setConfirmingHide(false)}
        >
          {hideConfirmMessage(entry.displayName)}
        </ConfirmDialog>
      )}
    </li>
  );
}

/** 通報 1 件。問題がなければ「対応済み」、問題があれば「作品を非公開に」（非公開にすると、通報も対応済みになる） */
function ReportCard({
  report,
  now,
  onChanged,
}: {
  report: ReportView;
  now: number;
  onChanged: () => void;
}) {
  const [confirmingHide, setConfirmingHide] = useState(false);
  const resolve = useAction(async () => {
    await api.call("resolveArchiveReport", { params: { reportId: report.id } });
    onChanged();
  });
  const hide = useAction(async () => {
    await api.call("hideArchiveEntry", { params: { entryId: report.archiveEntryId } });
    setConfirmingHide(false);
    onChanged();
  });
  const canHide = report.entry.status === "public";

  return (
    <li className="cb-arc__card" data-status={report.status}>
      <img
        src={report.entry.imageUrl}
        alt={`「${report.entry.displayName}」さんの作品`}
        className="cb-arc__image"
      />
      <div className="cb-arc__body">
        <p className="cb-arc__name">{reportHeadline(report)}</p>
        <p className="cb-muted">
          {waitedLabel(report.createdAt, now)}に通報 ・ 作品は {statusText[report.entry.status]}
        </p>
        <p className="cb-arc__reason">{report.reason}</p>
        {report.status === "open" ? (
          <div className="cb-arc__actions">
            {canHide && (
              <Button size="large" onClick={() => setConfirmingHide(true)}>
                作品を非公開にする
              </Button>
            )}
            <Button
              size="large"
              variant="line"
              disabled={resolve.running}
              onClick={() => void resolve.run()}
            >
              問題なし（対応済み）
            </Button>
          </div>
        ) : (
          <p className="cb-muted">対応済み</p>
        )}
        {resolve.error && <Notice tone="error">{resolve.error}</Notice>}
      </div>

      {canHide && (
        <ConfirmDialog
          open={confirmingHide}
          title="この作品を、非公開にしますか？"
          confirmLabel="非公開にする"
          running={hide.running}
          error={hide.error}
          onConfirm={() => void hide.run()}
          onCancel={() => setConfirmingHide(false)}
        >
          {hideConfirmMessage(report.entry.displayName)}
        </ConfirmDialog>
      )}
    </li>
  );
}

/**
 * アーカイブの審査（S06）。審査待ちの承認・却下、公開中の作品の非公開化、通報の確認と対応。
 * 権利面の判断のため、画像は大きく出す。迷うものは、そのまま（審査待ちのまま）にしておける（保留）
 */
export function ArchivePage() {
  const [tab, setTab] = useState<ArchiveTab>("pending");
  const now = useNow(30_000);

  // タブの件数（審査待ち・未対応の通報）は、どのタブにいても、見えるようにする
  const summary = useResource(
    async () => {
      const [pending, reports] = await Promise.all([
        api.call("listStaffArchive", { query: { status: "pending_review", limit: 100 } }),
        api.call("listArchiveReports", { query: { status: "open", limit: 100 } }),
      ]);
      return { pending: pending.items.length, reports: reports.items.length };
    },
    { refreshMs: REFRESH_MS },
  );

  const entries = useResource(() => (tab === "reports" ? Promise.resolve([]) : loadEntries(tab)), {
    deps: [tab],
    refreshMs: REFRESH_MS,
  });
  const reports = useResource(
    () =>
      tab === "reports"
        ? api.call("listArchiveReports", { query: { status: "open", limit: 100 } })
        : Promise.resolve({ items: [] as ReportView[], nextBefore: null }),
    { deps: [tab], refreshMs: REFRESH_MS },
  );

  const changed = () => {
    summary.reload();
    entries.reload();
    reports.reload();
  };
  const shown = useMemo(() => orderForReview(tab, entries.data ?? []), [tab, entries.data]);
  const error = tab === "reports" ? reports.error : entries.error;
  const loading = tab === "reports" ? reports.loading : entries.loading;

  return (
    <main className="cb-page cb-arc">
      <h1>アーカイブの審査</h1>
      <p className="cb-muted">
        来場者が投稿した作品を、公開してよいか確かめます。画像が、他人のキャラクターや写真に見えるときは、却下します。
        迷うときは、押さずに、そのままにしておけます（審査待ちのまま残ります）。
      </p>

      <div className="cb-switch" role="tablist" aria-label="審査の種類">
        {TABS.map((t) => (
          <button
            key={t}
            type="button"
            role="tab"
            aria-selected={tab === t}
            onClick={() => setTab(t)}
          >
            {archiveTabLabels[t]}
            {t === "pending" && summary.data && (
              <span className="cb-switch__count">{summary.data.pending}</span>
            )}
            {t === "reports" && summary.data && (
              <span className="cb-switch__count">{summary.data.reports}</span>
            )}
          </button>
        ))}
      </div>

      {error && <Notice tone="error">{error}</Notice>}

      <div role="tabpanel">
        {tab === "reports" ? (
          reports.data && reports.data.items.length === 0 && !loading ? (
            <p className="cb-muted">未対応の通報は、ありません。</p>
          ) : (
            <ul className="cb-arc__list">
              {(reports.data?.items ?? []).map((report) => (
                <ReportCard key={report.id} report={report} now={now} onChanged={changed} />
              ))}
            </ul>
          )
        ) : shown.length === 0 && !loading ? (
          <p className="cb-muted">
            {tab === "pending" ? "審査待ちの作品は、ありません。" : "作品は、ありません。"}
          </p>
        ) : (
          <ul className="cb-arc__list">
            {shown.map((entry) => (
              <EntryCard key={entry.id} entry={entry} now={now} onChanged={changed} />
            ))}
          </ul>
        )}
      </div>
    </main>
  );
}
