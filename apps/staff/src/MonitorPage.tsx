import { QrCode, useResource } from "@canbadge/ui";
import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "./api";
import { siteUrl } from "./env";
import { densityFor, newlyReady, sortReady } from "./monitor-logic";
import "./monitor.css";

/** 処理PC の中のアドレスか。呼び出しモニターの API は、ここからしか使えない */
const isLocalHost = (hostname: string): boolean =>
  hostname === "localhost" || hostname === "127.0.0.1" || hostname.endsWith(".localhost");

/** 新しくできあがった番号を、目立たせておく時間 */
const HIGHLIGHT_MS = 8000;

/**
 * 呼び出しモニター。処理 PC の 2 画面目に、全画面で出す表示専用の画面（操作はない）。
 * できあがった（ready）番号を大きく並べ、受け渡されたら消える。サイトへの固定 QR も出す。
 * 注文 ID は api が返さない（QR の中身なので、画面に出さない）
 */
export function MonitorPage() {
  const ready = useResource(() => api.call("getMonitorReady"), {
    subscribe: (reload) => api.subscribe("monitorEvents", { onEvent: reload, onOpen: reload }),
    // 回線や SSE が途切れても、画面が古いままにならないよう、念のため定期的に読み直す
    refreshMs: 15000,
  });
  const items = useMemo(() => sortReady(ready.data?.items ?? []), [ready.data]);

  // 新しい番号を、しばらく目立たせる。最初の表示では、何も光らせない
  const seen = useRef<Set<number> | undefined>(undefined);
  const [fresh, setFresh] = useState<ReadonlySet<number>>(new Set());
  useEffect(() => {
    if (!ready.data) return;
    const added = newlyReady(seen.current, items);
    seen.current = new Set(items.map((item) => item.orderNumber));
    if (added.size === 0) return;
    setFresh((current) => new Set([...current, ...added]));
    const timer = setTimeout(
      () => setFresh((current) => new Set([...current].filter((n) => !added.has(n)))),
      HIGHLIGHT_MS,
    );
    return () => clearTimeout(timer);
  }, [items, ready.data]);

  const digits = Math.max(3, ...items.map((item) => item.orderNumberText.length));

  return (
    <main className="cb-monitor" data-density={densityFor(items.length)}>
      <section className="cb-monitor__called" aria-label="お呼び出し中の番号" aria-live="polite">
        <h1 className="cb-monitor__title">できあがりました</h1>
        {items.length === 0 ? (
          <p className="cb-monitor__empty">いまお呼び出し中の番号はありません</p>
        ) : (
          <ul className="cb-monitor__grid" style={{ "--digits": digits } as React.CSSProperties}>
            {items.map((item) => (
              <li
                key={item.orderNumber}
                className="cb-monitor__cell"
                data-fresh={fresh.has(item.orderNumber) || undefined}
              >
                <span className="cb-monitor__number">{item.orderNumberText}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <aside className="cb-monitor__side">
        {/* 「方は、」だけが 1 行に残らないよう、意味の切れ目で 2 行に分ける */}
        <p className="cb-monitor__guide">
          <span>番号を呼ばれた方は</span>
          <span>受け取り口へ</span>
        </p>
        {siteUrl ? (
          <figure className="cb-monitor__qr">
            <QrCode value={siteUrl} label="缶バッジの注文サイトの QR コード" />
            <figcaption>
              <strong>注文はこちらから</strong>
              <span>スマホで読み取ってください</span>
            </figcaption>
          </figure>
        ) : (
          // 来場者には見せない、スタッフ向けの注意（QR が出ていないことに、気づけるように）
          <p className="cb-monitor__missing">サイトの URL（VITE_SITE_URL）が、未設定です</p>
        )}
        {ready.error &&
          (isLocalHost(window.location.hostname) ? (
            <p className="cb-monitor__offline" role="status">
              通信が途切れています。番号が、古い可能性があります
            </p>
          ) : (
            // 呼び出しモニターの API は、処理PC の中だけ（spec 4 章）。公開のアドレスでは、回線ではなく、経路が理由で断られる
            <p className="cb-monitor__offline" role="status">
              このモニターは、処理PC
              の中で開いてください（http://staff.localhost:8080/monitor）。公開のアドレスからは、番号を取得できません
            </p>
          ))}
      </aside>
    </main>
  );
}
