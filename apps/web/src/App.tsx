import { usePath } from "@canbadge/ui";
import { ArchivePostPage } from "./ArchivePostPage";
import { LookupPage } from "./LookupPage";
import { MyArchivePage } from "./MyArchivePage";
import { OrderPage } from "./OrderPage";
import { OrderStatusPage } from "./OrderStatusPage";

/** パスで画面を切り替える最小限のルーティング（仮）。注文確定のあとは /orders/<注文 ID> に移る。/lookup は、注文番号と確認コードで注文を開く */
export function App() {
  const path = usePath();
  const match = /^\/orders\/([0-9A-Za-z]+)$/.exec(path);
  if (match?.[1]) return <OrderStatusPage orderId={match[1]} />;
  if (path === "/lookup") return <LookupPage />;
  if (path === "/archive/post") return <ArchivePostPage />;
  if (path === "/archive/mine") return <MyArchivePage />;
  return <OrderPage />;
}
