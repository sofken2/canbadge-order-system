import { orderStatusLabels, type StaffOrderView } from "@canbadge/shared";
import { useAction, useResource } from "@canbadge/ui";
import { useState } from "react";
import { api } from "./api";

// 仮画面（T09）。大きなボタン・長時間未受け取りの強調表示（S04）は、組み立て・受け渡し画面で作る。

/** 注文 1 件の行。状態に応じて、次の操作のボタンを出す（組み立て開始 → 完成 → 受け渡し） */
function OrderRow({ order, onDone }: { order: StaffOrderView; onDone: () => void }) {
  const [code, setCode] = useState("");
  const step = useAction(async (to: "assemble" | "complete" | "pickup") => {
    if (to === "assemble") await api.call("assembleOrder", { params: { orderId: order.id } });
    if (to === "complete") await api.call("completeOrder", { params: { orderId: order.id } });
    if (to === "pickup") {
      // 確認コードの照合は api が行う（画面に正解を持たせない）
      await api.call("pickupOrder", {
        params: { orderId: order.id },
        body: { confirmationCode: code },
      });
    }
    setCode("");
    onDone();
  });

  return (
    <li>
      <strong style={{ fontSize: "1.5rem" }}>{order.orderNumberText}</strong>{" "}
      {orderStatusLabels[order.status]}{" "}
      {order.status === "printed" && (
        <button type="button" onClick={() => void step.run("assemble")} disabled={step.running}>
          組み立て開始
        </button>
      )}
      {order.status === "assembling" && (
        <button type="button" onClick={() => void step.run("complete")} disabled={step.running}>
          完成
        </button>
      )}
      {order.status === "ready" && (
        <>
          <input
            value={code}
            placeholder="確認コード"
            size={6}
            onChange={(event) => setCode(event.target.value)}
          />{" "}
          <button
            type="button"
            onClick={() => void step.run("pickup")}
            disabled={step.running || code.trim() === ""}
          >
            受け渡し
          </button>
        </>
      )}
      {step.error && <span role="alert"> {step.error}</span>}
    </li>
  );
}

/** 組み立て・受け渡し。印刷済み・組み立て中・完成の注文の一覧 */
export function AssemblePage() {
  const orders = useResource(
    () =>
      api.call("searchStaffOrders", { query: { status: "printed,assembling,ready", limit: 50 } }),
    { subscribe: (reload) => api.subscribe("staffEvents", { onEvent: reload, onOpen: reload }) },
  );

  if (orders.error) return <p role="alert">{orders.error}</p>;
  // 古い注文（番号の小さい注文）から順に並べる
  const items = [...(orders.data?.items ?? [])].sort((a, b) => a.orderNumber - b.orderNumber);

  return (
    <main>
      <h1>組み立て・受け渡し（仮画面）</h1>
      {items.length === 0 && <p>対象の注文はありません。</p>}
      <ul>
        {items.map((order) => (
          <OrderRow key={order.id} order={order} onDone={orders.reload} />
        ))}
      </ul>
    </main>
  );
}
