import type { StaffOrderView } from "@canbadge/shared";
import { Button, Notice, TextField, useAction } from "@canbadge/ui";
import { useState } from "react";
import { api } from "./api";

// 仮画面（T09）。見た目は @canbadge/ui の部品（T10）。QR の読み取り（S01）・お釣りの計算・取り消し（S02）は、レジ画面で作る。

/** レジ。注文番号（または QR の中身の注文 ID）を入れて、支払い待ちの注文を探し、支払い済みにする */
export function RegisterPage() {
  const [text, setText] = useState("");
  const [found, setFound] = useState<StaffOrderView | undefined>(undefined);
  const [message, setMessage] = useState<string | undefined>(undefined);

  const search = useAction(async () => {
    setMessage(undefined);
    setFound(undefined);
    const page = await api.call("searchStaffOrders", {
      query: { q: text.trim(), status: "submitted", limit: 5 },
    });
    const order = page.items[0];
    if (order) setFound(order);
    else setMessage("支払い待ちの注文が見つかりません（注文番号か、QR の中身を確かめてください）");
  });

  const pay = useAction(async (order: StaffOrderView) => {
    const paid = await api.call("payOrder", { params: { orderId: order.id } });
    setMessage(`注文 ${paid.orderNumberText} を支払い済みにしました（${paid.totalAmount}円）`);
    setFound(undefined);
    setText("");
  });

  return (
    <main className="cb-page">
      <h1>レジ</h1>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void search.run();
        }}
      >
        <TextField
          numeric
          label="注文番号"
          hint="QR を読むか、番号を入れます"
          value={text}
          inputMode="numeric"
          onChange={(event) => setText(event.target.value)}
        />
        <Button variant="ink" type="submit" disabled={text.trim() === "" || search.running}>
          探す
        </Button>
      </form>

      {search.error && <Notice tone="error">{search.error}</Notice>}
      {message && <Notice>{message}</Notice>}

      {found && (
        <section className="cb-panel cb-gap-top">
          <h2>
            注文 <span className="cb-number cb-number--medium">{found.orderNumberText}</span>
          </h2>
          {found.items.map((item) => (
            <img
              key={item.id}
              src={item.thumbnailUrl}
              alt="バッジの画像"
              width={120}
              height={120}
              className="cb-thumb"
            />
          ))}
          <p>
            個数 {found.items.reduce((sum, item) => sum + item.quantity, 0)} ／ 金額{" "}
            <strong>{found.totalAmount}円</strong>
          </p>
          <Button size="large" block onClick={() => void pay.run(found)} disabled={pay.running}>
            支払い済みにする（現金）
          </Button>
          {pay.error && <Notice tone="error">{pay.error}</Notice>}
        </section>
      )}
    </main>
  );
}
