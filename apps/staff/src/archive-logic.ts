import {
  type ArchiveStatus,
  archiveStatusLabels,
  type ReportView,
  type StaffArchiveEntryView,
} from "@canbadge/shared";
import { formatWait, minutesSince } from "./assemble-logic";

// アーカイブの審査（S06）。画面の計算の部分。画面（ArchivePage）は、これを呼ぶだけにする。

export type ArchiveTab = "pending" | "public" | "reports" | "closed";

export const archiveTabLabels: Record<ArchiveTab, string> = {
  pending: "審査待ち",
  public: "公開中",
  reports: "通報",
  closed: "却下・非公開",
};

/** タブごとに読む作品の状態。通報のタブは、作品ではなく、通報の一覧を読む */
export const tabStatuses: Record<Exclude<ArchiveTab, "reports">, ArchiveStatus[]> = {
  pending: ["pending_review"],
  public: ["public"],
  closed: ["rejected", "hidden"],
};

/**
 * 審査待ちは、古いものから（待たせている順）。api は新しい順で返すので、画面で、逆にする。
 * それ以外は、新しい順のまま
 */
export function orderForReview<T extends { createdAt: string }>(
  tab: ArchiveTab,
  items: readonly T[],
): T[] {
  return tab === "pending" ? [...items].reverse() : [...items];
}

/** 「3 分前」「1 時間 5 分前」。時刻が読めなければ、空 */
export function waitedLabel(iso: string | undefined, now: number): string {
  const minutes = minutesSince(iso, now);
  if (minutes === undefined) return "";
  return minutes === 0 ? "たったいま" : `${formatWait(minutes)}前`;
}

/** 審査待ちが、どれくらい待たされているか。長く待たせている作品を、目立たせる */
export const LONG_PENDING_MINUTES = 30;

export function isLongPending(entry: StaffArchiveEntryView, now: number): boolean {
  return (
    entry.status === "pending_review" &&
    (minutesSince(entry.createdAt, now) ?? 0) >= LONG_PENDING_MINUTES
  );
}

/** 非公開にする前の確認の文。何が起きるかを、具体的に書く（取り消せない操作なので） */
export function hideConfirmMessage(displayName: string): string {
  return `「${displayName}」さんの作品を、非公開にします。来場者の一覧から消えます。この作品をコピーして、まだ支払っていない注文は、止まります（支払い済みの注文は、そのままです）。この作品への、未対応の通報は、対応済みになります。`;
}

/** 通報の一覧の、見出しの 1 行 */
export function reportHeadline(report: ReportView): string {
  return `「${report.entry.displayName}」さんの作品への通報`;
}

/** 作品の状態の、画面に出す名前。表記がずれないよう、契約（shared）の表示名をそのまま使う */
export const statusText: Record<ArchiveStatus, string> = archiveStatusLabels;

/** 未対応の通報の数の、タブに出す件数 */
export function countOpenReports(reports: readonly ReportView[]): number {
  return reports.filter((r) => r.status === "open").length;
}
