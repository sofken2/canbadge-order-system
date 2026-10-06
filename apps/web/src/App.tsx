import { usePath } from "@canbadge/ui";
import { OrderPage } from "./OrderPage";
import { OrderStatusPage } from "./OrderStatusPage";

/** パスで画面を切り替える最小限のルーティング（仮）。注文確定のあとは /orders/<注文 ID> に移る */
export function App() {
  const path = usePath();
  const match = /^\/orders\/([0-9A-Za-z]+)$/.exec(path);
  return match?.[1] ? <OrderStatusPage orderId={match[1]} /> : <OrderPage />;
}
