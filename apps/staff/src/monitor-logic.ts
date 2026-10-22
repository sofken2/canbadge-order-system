import type { MonitorReadyItem } from "@canbadge/shared";

// 呼び出しモニターの、画面から切り離した判定（テストできるように）。

/** できあがった順（古い順）に並べる。長く待っているお客さんの番号が、先に見える */
export function sortReady(items: readonly MonitorReadyItem[]): MonitorReadyItem[] {
  return [...items].sort(
    (a, b) => a.readyAt.localeCompare(b.readyAt) || a.orderNumber - b.orderNumber,
  );
}

export type Density = "solo" | "few" | "some" | "many" | "crowded";

/** 番号の数に応じた、並べ方の密度。少ないときは、番号を最大にし、増えたら、列を増やして、すべて見えるようにする */
export function densityFor(count: number): Density {
  // 2 つまでは 1 列にして、番号を画面の幅いっぱいまで大きくする（2 列だと、画面の下半分が空く）
  if (count <= 2) return "solo";
  if (count <= 4) return "few";
  if (count <= 9) return "some";
  if (count <= 20) return "many";
  return "crowded";
}

/** 前の表示になかった番号（新しくできあがった番号）。最初の表示では、すべてを「新しい」としない */
export function newlyReady(
  previous: ReadonlySet<number> | undefined,
  items: readonly MonitorReadyItem[],
): Set<number> {
  if (!previous) return new Set();
  return new Set(items.map((item) => item.orderNumber).filter((n) => !previous.has(n)));
}

/** 固定 QR の URL。空や、https（開発では http も）でない文字列は、使わない（画面に出す前に、確かめる） */
export function siteUrlFrom(raw: string | undefined): string | undefined {
  const value = raw?.trim();
  if (!value) return undefined;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}
