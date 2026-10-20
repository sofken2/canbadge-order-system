import { usePath } from "@canbadge/ui";
import { ArchiveDetailPage } from "./ArchiveDetailPage";
import { ArchiveListPage } from "./ArchiveListPage";
import { ArchivePostPage } from "./ArchivePostPage";
import { HomePage } from "./HomePage";
import { LookupPage } from "./LookupPage";
import { MyArchivePage } from "./MyArchivePage";
import { OrderPage } from "./OrderPage";
import { OrderStatusPage } from "./OrderStatusPage";

/**
 * パスで画面を切り替える最小限のルーティング（仮）。/ は、はじめの画面（注文・作品を見る・注文の確認への入口）で、
 * 注文のデザイン画面は /order（そのほかの知らないパスも、ここ）。注文確定のあとは /orders/<注文 ID> に移る。/lookup は、注文番号と確認コードで注文を開く */
export function App() {
  const path = usePath();
  const match = /^\/orders\/([0-9A-Za-z]+)$/.exec(path);
  if (match?.[1]) return <OrderStatusPage orderId={match[1]} />;
  if (path === "/") return <HomePage />;
  if (path === "/lookup") return <LookupPage />;
  if (path === "/archive/post") return <ArchivePostPage />;
  if (path === "/archive/mine") return <MyArchivePage />;
  if (path === "/archive") return <ArchiveListPage />;
  const entry = /^\/archive\/([0-9A-Za-z]{26})$/.exec(path);
  if (entry?.[1]) return <ArchiveDetailPage entryId={entry[1]} />;
  return <OrderPage />;
}
