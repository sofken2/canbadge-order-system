import { acceptanceLabels } from "@canbadge/shared";
import { navigate, useAction, useResource } from "@canbadge/ui";
import { useState } from "react";
import { api } from "./api";

// 仮画面（T09）。見た目は作らない。注文フロー（W02）と、エディタ（W01）で置き換える。

/** 注文する。画像を選び、権利確認に同意して、注文を確定する */
export function OrderPage() {
  const status = useResource(() => api.call("getStatus"), { refreshMs: 5000 });
  const [file, setFile] = useState<File | undefined>(undefined);
  const [quantity, setQuantity] = useState(1);
  const [consent, setConsent] = useState(false);

  const submit = useAction(async () => {
    if (!file) throw new Error("画像を選んでください");
    const { imageId } = await api.uploadImage(file);
    const { orderId } = await api.call("createOrder", {
      body: {
        imageId,
        // 本物の編集データは、エディタ（W01）が作る
        editorData: { version: 1, source: "temporary-upload" },
        quantity,
        // Turnstile の検証は A06。それまでは決まった文字列を送る
        turnstileToken: "dev",
        rightsConsent: true,
      },
    });
    navigate(`/orders/${orderId}`);
  });

  const setting = status.data;
  const accepting = setting?.acceptance === "open";

  return (
    <main>
      <h1>缶バッジを注文する（仮画面）</h1>
      {status.error && <p role="alert">{status.error}</p>}
      {setting && (
        <p>
          受付：{acceptanceLabels[setting.acceptance]} ／ 価格：{setting.price}円 ／ 待ち：
          {setting.waitingCount}件
        </p>
      )}
      {setting && !accepting && (
        <p role="alert">{setting.busyMessage ?? "現在、注文を受け付けていません。"}</p>
      )}

      <form
        onSubmit={(event) => {
          event.preventDefault();
          void submit.run();
        }}
      >
        <p>
          <label>
            画像（PNG・JPEG）：
            <input
              type="file"
              accept="image/png,image/jpeg"
              onChange={(event) => setFile(event.target.files?.[0])}
            />
          </label>
        </p>
        {setting && setting.maxQuantityPerOrder > 1 && (
          <p>
            <label>
              個数：
              <input
                type="number"
                min={1}
                max={setting.maxQuantityPerOrder}
                value={quantity}
                onChange={(event) => setQuantity(Number(event.target.value))}
              />
            </label>
          </p>
        )}
        <p>
          <label>
            <input
              type="checkbox"
              checked={consent}
              onChange={(event) => setConsent(event.target.checked)}
            />
            自作の画像、または使用してよい画像です
          </label>
        </p>
        <button type="submit" disabled={!accepting || !file || !consent || submit.running}>
          {submit.running ? "送信中…" : "注文する"}
        </button>
        {submit.error && <p role="alert">{submit.error}</p>}
      </form>
    </main>
  );
}
