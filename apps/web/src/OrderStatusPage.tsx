import { orderStatusLabels } from "@canbadge/shared";
import { useResource } from "@canbadge/ui";
import { api } from "./api";

// 仮画面（T09）。QR・見た目は、注文状況ページ（W03）で作る。

/** 注文状況。レジで言う注文番号と、受け渡しで言う確認コードを出し、状態の変化に自動で追従する */
export function OrderStatusPage({ orderId }: { orderId: string }) {
  const order = useResource(() => api.call("getOrder", { params: { orderId } }), {
    deps: [orderId],
    // 「変わった」の通知と、つながったとき（再接続も含む）に、取り直す
    subscribe: (reload) =>
      api.subscribe("orderEvents", {
        params: { orderId },
        onEvent: reload,
        onOpen: reload,
      }),
  });

  if (order.error) return <p role="alert">{order.error}</p>;
  if (!order.data) return <p>読み込み中…</p>;
  const o = order.data;

  return (
    <main>
      <h1>注文状況（仮画面）</h1>
      <p>
        注文番号：<strong style={{ fontSize: "3rem" }}>{o.orderNumberText}</strong>
      </p>
      <p>
        確認コード：
        <strong style={{ fontSize: "2rem", letterSpacing: "0.2em" }}>{o.confirmationCode}</strong>
      </p>
      <p>状態：{orderStatusLabels[o.status]}</p>
      <p>金額：{o.totalAmount}円（支払いは、ブースのレジで現金です）</p>
      {o.items.map((item) => (
        <img
          key={item.id}
          src={item.thumbnailUrl}
          alt="注文したバッジの画像"
          width={160}
          height={160}
        />
      ))}
      <p>
        <small>注文 ID：{o.id}</small>
      </p>
    </main>
  );
}
