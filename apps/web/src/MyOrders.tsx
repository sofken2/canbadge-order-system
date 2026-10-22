import { ApiClientError } from "@canbadge/api-client";
import { type OrderStatus, orderStatusLabels } from "@canbadge/shared";
import { navigate, useResource } from "@canbadge/ui";
import { api } from "./api";
import { forgetOrders, rememberedOrders } from "./my-orders";
import { progressIndex } from "./order-status";

/**
 * この端末で開いた注文の一覧（注文番号と確認コードを入れなくても、押せば開ける）。
 * 中身は、開くたびに api から取り直す。見つからない注文（DB を作り直したときなど）と、
 * 止まった注文（期限切れ・取り消し・返金）は、開いてもすることがないので、一覧から外し、覚えておくのもやめる。
 * 1 件もなければ、何も出さない
 */
/** 期限切れ・取り消し・返金。進み具合がない状態（order-status.ts）と同じ区切り */
function isStopped(status: OrderStatus): boolean {
  return progressIndex(status) === undefined;
}

export function MyOrders() {
  const orders = useResource(async () => {
    const ids = rememberedOrders();
    const results = await Promise.allSettled(
      ids.map((orderId) => api.call("getOrder", { params: { orderId } })),
    );
    const gone = ids.filter((_, index) => {
      const result = results[index];
      if (result?.status === "fulfilled") return isStopped(result.value.status);
      return result?.reason instanceof ApiClientError && result.reason.status === 404;
    });
    forgetOrders(gone);
    return results.flatMap((result) =>
      result.status === "fulfilled" && !isStopped(result.value.status) ? [result.value] : [],
    );
  });

  const list = orders.data ?? [];
  if (list.length === 0) return null;

  return (
    <section className="cb-my-orders" aria-labelledby="cb-my-orders-title">
      <h2 id="cb-my-orders-title">この端末の注文</h2>
      <ul>
        {list.map((order) => (
          <li key={order.id}>
            <button
              type="button"
              className="cb-my-orders__item"
              onClick={() => navigate(`/orders/${order.id}`)}
            >
              <span className="cb-my-orders__number">{order.orderNumberText}</span>
              <span className="cb-my-orders__status">{orderStatusLabels[order.status]}</span>
              <span className="cb-my-orders__open" aria-hidden="true">
                開く →
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
