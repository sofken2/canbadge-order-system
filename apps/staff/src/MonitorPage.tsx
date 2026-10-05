import { useResource } from "@canbadge/ui";
import { api } from "./api";

// 仮画面（T09）。文字の大きさ・サイトへの固定 QR（S05）は、呼び出しモニターで作る。

/** 呼び出しモニター。完成した（ready）注文の番号を、大きく並べる。注文 ID は、api が返さない */
export function MonitorPage() {
  const ready = useResource(() => api.call("getMonitorReady"), {
    subscribe: (reload) => api.subscribe("monitorEvents", { onEvent: reload, onOpen: reload }),
  });

  if (ready.error) return <p role="alert">{ready.error}</p>;
  const items = ready.data?.items ?? [];

  return (
    <main>
      <h1>お呼び出し（仮画面）</h1>
      {items.length === 0 && <p>いま、お呼び出し中の番号はありません。</p>}
      <ul style={{ listStyle: "none", padding: 0, display: "flex", flexWrap: "wrap", gap: "1rem" }}>
        {items.map((item) => (
          <li key={item.orderNumber} style={{ fontSize: "6rem", fontWeight: "bold" }}>
            {item.orderNumberText}
          </li>
        ))}
      </ul>
    </main>
  );
}
