import { Button, navigate } from "@canbadge/ui";

/** はじめの画面。やりたいことを選んで、それぞれの画面へ進む（注文・作品を見る・自分の注文を確認） */
export function HomePage() {
  return (
    <main className="cb-page">
      <h1>オリジナル缶バッジ</h1>
      <p className="cb-muted">やりたいことを選んでください。</p>
      <Button block size="large" onClick={() => navigate("/order")}>
        バッジを注文する
      </Button>
      <Button variant="line" block size="large" onClick={() => navigate("/archive")}>
        みんなの作品を見る
      </Button>
      <Button variant="line" block size="large" onClick={() => navigate("/lookup")}>
        自分の注文を確認する
      </Button>
    </main>
  );
}
