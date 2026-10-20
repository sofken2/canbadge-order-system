import type { ArchiveStatus } from "@canbadge/shared";
import { Button, Checkbox, Notice, navigate, useAction, useResource } from "@canbadge/ui";
import { useRef, useState } from "react";
import { api } from "./api";
import { orderBlockedReason, orderErrorMessage } from "./archive-view-logic";
import { DEV_TURNSTILE_TOKEN, turnstileSiteKey } from "./env";
import { KiraFilmPicker, orderTotal } from "./KiraFilmPicker";
import { QuantityPicker } from "./QuantityPicker";
import { TurnstileWidget } from "./TurnstileWidget";

/**
 * 公開されている作品を、コピーして、注文する（W07）。作品は、このまま、バッジになる（まだ編集できない）。
 * 受付・個数の上限・Turnstile・端末あたりの上限は、通常の注文と同じ（api が、同じ処理で判定する）
 */
export function ArchiveOrderPanel({
  entryId,
  entryStatus,
}: {
  entryId: string;
  entryStatus: ArchiveStatus;
}) {
  const status = useResource(() => api.call("getStatus"), { refreshMs: 5000 });
  const [quantity, setQuantity] = useState(1);
  const [kiraSelected, setKiraSelected] = useState(0);
  // 個数を減らしたとき、キラの個数が個数を超えないようにする
  const kiraQuantity = Math.min(kiraSelected, quantity);
  const [consent, setConsent] = useState(false);
  const [token, setToken] = useState<string | undefined>(undefined);
  /** 注文を試すたびに増やす。Turnstile のトークンは 1 回しか使えないので、作り直す */
  const [tokenVersion, setTokenVersion] = useState(0);

  const submitting = useRef(false);
  const submit = useAction(async () => {
    // 二度押しで、注文が重複しないようにする
    if (submitting.current) return;
    submitting.current = true;
    try {
      const { orderId } = await api.call("orderFromArchive", {
        params: { entryId },
        body: {
          quantity,
          kiraQuantity,
          turnstileToken: turnstileSiteKey ? (token ?? "") : DEV_TURNSTILE_TOKEN,
          rightsConsent: true,
        },
      });
      navigate(`/orders/${orderId}`);
    } catch (error) {
      // 失敗したら、確認をやり直す（使ったトークンは、もう使えない）
      setTokenVersion((version) => version + 1);
      throw new Error(orderErrorMessage(error instanceof Error ? error.message : String(error)));
    } finally {
      submitting.current = false;
    }
  });

  const setting = status.data;
  const blocked = setting
    ? orderBlockedReason({
        accepting: setting.acceptance === "open",
        busyMessage: setting.busyMessage,
        entryStatus,
      })
    : undefined;
  const maxQuantity = setting?.maxQuantityPerOrder ?? 1;
  const needsToken = turnstileSiteKey !== undefined;
  const canSubmit =
    !!setting && !blocked && consent && (!needsToken || token !== undefined) && !submit.running;
  const total = orderTotal(setting, quantity, kiraQuantity);

  return (
    <section className="cb-arcorder" aria-label="この作品で注文する">
      <h2>この作品で、注文する</h2>
      <p className="cb-muted">
        この作品は、このまま、バッジになります（デザインは、変えられません）。作者は、他のお客さんが注文することを、認めています。
      </p>

      {status.error && <Notice tone="error">{status.error}</Notice>}
      {blocked && <Notice tone="error">{blocked}</Notice>}

      {setting && !blocked && (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (canSubmit) void submit.run();
          }}
        >
          <QuantityPicker value={quantity} max={maxQuantity} onChange={setQuantity} />
          <KiraFilmPicker
            value={kiraQuantity}
            quantity={quantity}
            price={setting.kiraFilmPrice}
            onChange={setKiraSelected}
          />
          <dl className="cb-summary cb-gap-top">
            <dt>金額</dt>
            <dd>
              <strong>{total}円</strong>
              {(quantity > 1 || kiraQuantity > 0) && (
                <span className="cb-muted">
                  （{setting.price}円 × {quantity}
                  {kiraQuantity > 0 && ` + キラ ${setting.kiraFilmPrice}円 × ${kiraQuantity}`}）
                </span>
              )}
            </dd>
          </dl>
          <Checkbox
            label="公開されている、他のお客さんの作品を、バッジにすることを、了解しました"
            checked={consent}
            onChange={(event) => setConsent(event.target.checked)}
          />
          {turnstileSiteKey && (
            <TurnstileWidget
              siteKey={turnstileSiteKey}
              onToken={setToken}
              resetKey={tokenVersion}
            />
          )}
          <Button type="submit" size="large" block disabled={!canSubmit}>
            {submit.running ? "注文しています…" : "この作品で、注文する"}
          </Button>
          <p className="cb-muted cb-center cb-gap-top">お金は、ブースのレジで現金で払います</p>
          {submit.error && <Notice tone="error">{submit.error}</Notice>}
        </form>
      )}
    </section>
  );
}
