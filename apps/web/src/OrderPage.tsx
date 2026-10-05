import { acceptanceLabels } from "@canbadge/shared";
import {
  Button,
  Checkbox,
  Notice,
  navigate,
  TextField,
  useAction,
  useResource,
} from "@canbadge/ui";
import { useState } from "react";
import { api } from "./api";

// 仮画面（T09）。見た目は @canbadge/ui の部品（T10）。注文フロー（W02）と、エディタ（W01）で置き換える。

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
    <main className="cb-page">
      <h1>オリジナル缶バッジを、つくろう</h1>
      {status.error && <Notice tone="error">{status.error}</Notice>}
      {setting && (
        <p className="cb-muted">
          受付：{acceptanceLabels[setting.acceptance]} ／ {setting.price}円 / 1個 ／ いま
          {setting.waitingCount}件待ち
        </p>
      )}
      {setting && !accepting && (
        <Notice tone="error">{setting.busyMessage ?? "現在、注文を受け付けていません。"}</Notice>
      )}

      <form
        onSubmit={(event) => {
          event.preventDefault();
          void submit.run();
        }}
      >
        <TextField
          label="画像"
          hint="PNG・JPEG。丸く切り抜かれます"
          type="file"
          accept="image/png,image/jpeg"
          onChange={(event) => setFile(event.target.files?.[0])}
        />
        {setting && setting.maxQuantityPerOrder > 1 && (
          <TextField
            label="個数"
            type="number"
            min={1}
            max={setting.maxQuantityPerOrder}
            value={quantity}
            onChange={(event) => setQuantity(Number(event.target.value))}
          />
        )}
        <Checkbox
          label="自作の画像、または使ってよい画像です"
          checked={consent}
          onChange={(event) => setConsent(event.target.checked)}
        />
        <Button
          type="submit"
          size="large"
          block
          disabled={!accepting || !file || !consent || submit.running}
        >
          {submit.running ? "送信中…" : "注文する"}
        </Button>
        <p className="cb-muted cb-center cb-gap-top">お金は、ブースのレジで現金で払います</p>
        {submit.error && <Notice tone="error">{submit.error}</Notice>}
      </form>
    </main>
  );
}
