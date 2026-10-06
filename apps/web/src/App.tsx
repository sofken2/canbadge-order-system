import { usePath } from "@canbadge/ui";
import { EditorPreviewPage } from "./EditorPreviewPage";
import { OrderPage } from "./OrderPage";
import { OrderStatusPage } from "./OrderStatusPage";

/** パスで画面を切り替える最小限のルーティング（仮）。/editor はエディタの確認用。注文確定のあとは /orders/<注文 ID> に移る */
export function App() {
  const path = usePath();
  if (path === "/editor") return <EditorPreviewPage />;
  const match = /^\/orders\/([0-9A-Za-z]+)$/.exec(path);
  return match?.[1] ? <OrderStatusPage orderId={match[1]} /> : <OrderPage />;
}
