import type { StatusResponse } from "@canbadge/shared";
import { Button, Checkbox } from "@canbadge/ui";

/** 追加加工（キラフィルム・マグネット）の、価格と在庫。型は契約（getStatus の応答）から取る */
export type Addons = Pick<
  StatusResponse,
  | "price"
  | "kiraFilmPrice"
  | "magnetPrice"
  | "badgeRemaining"
  | "kiraFilmRemaining"
  | "magnetRemaining"
>;

/** 金額は円の整数。追加加工は、選んだ個数ぶんだけ加算する */
export function orderTotal(
  setting: Pick<Addons, "price" | "kiraFilmPrice" | "magnetPrice"> | undefined,
  quantity: number,
  kiraQuantity: number,
  magnetQuantity: number,
): number {
  if (!setting) return 0;
  return (
    setting.price * quantity +
    setting.kiraFilmPrice * kiraQuantity +
    setting.magnetPrice * magnetQuantity
  );
}

/**
 * 追加加工を付ける個数の選択。個数が 1 のときはチェック 1 つ、2 以上のときは −／＋ で、個数単位で選ぶ。
 * 付けられるのは、注文の個数と、在庫の残りの小さいほうまで。残りが 0 なら、売り切れとして選べない。
 * 通常の注文と、作品からの注文（W07）で、同じものを使う
 */
export function AddonPicker({
  name,
  value,
  quantity,
  price,
  remaining,
  onChange,
}: {
  /** 加工の名前（例: キラフィルム） */
  name: string;
  value: number;
  /** 注文の個数 */
  quantity: number;
  /** 1 個あたりの加算額（円） */
  price: number;
  /** 在庫の残り */
  remaining: number;
  onChange: (next: number) => void;
}) {
  const max = Math.min(quantity, remaining);
  if (remaining <= 0) {
    return (
      <p className="cb-muted cb-gap-top" role="status">
        {name}は売り切れです
      </p>
    );
  }
  if (quantity <= 1) {
    // チェック 1 つのときは、上に余白を足さない（キラフィルム・マグネット・同意のチェックを、同じ間隔で並べる）
    return (
      <Checkbox
        label={`${name}を付ける（+${price}円）`}
        checked={value > 0}
        onChange={(event) => onChange(event.target.checked ? 1 : 0)}
      />
    );
  }
  return (
    <div className="cb-quantity cb-gap-top">
      <span className="cb-field__label">
        {name}を付ける個数（1 個につき +{price}円）
      </span>
      <div className="cb-quantity__controls">
        <Button
          variant="line"
          aria-label={`${name}の個数を減らす`}
          disabled={value <= 0}
          onClick={() => onChange(Math.max(0, value - 1))}
        >
          −
        </Button>
        <output className="cb-quantity__value" aria-live="polite">
          {value} 個
        </output>
        <Button
          variant="line"
          aria-label={`${name}の個数を増やす`}
          disabled={value >= max}
          onClick={() => onChange(Math.min(max, value + 1))}
        >
          ＋
        </Button>
      </div>
    </div>
  );
}
