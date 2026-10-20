import { Button, Checkbox } from "@canbadge/ui";

/** 金額は円の整数。キラフィルムは、貼る個数ぶんだけ加算する */
export function orderTotal(
  setting: { price: number; kiraFilmPrice: number } | undefined,
  quantity: number,
  kiraQuantity: number,
): number {
  if (!setting) return 0;
  return setting.price * quantity + setting.kiraFilmPrice * kiraQuantity;
}

/**
 * キラフィルムを貼る個数の選択。個数が 1 のときはチェック 1 つ、2 以上のときは −／＋ で、個数単位で選ぶ。
 * 通常の注文と、作品からの注文（W07）で、同じものを使う
 */
export function KiraFilmPicker({
  value,
  quantity,
  price,
  onChange,
}: {
  value: number;
  /** 注文の個数。貼る個数は、これを超えられない */
  quantity: number;
  /** 1 個あたりの加算額（円） */
  price: number;
  onChange: (next: number) => void;
}) {
  if (quantity <= 1) {
    return (
      <div className="cb-gap-top">
        <Checkbox
          label={`キラフィルムを上から貼る（+${price}円）`}
          checked={value > 0}
          onChange={(event) => onChange(event.target.checked ? 1 : 0)}
        />
      </div>
    );
  }
  return (
    <div className="cb-quantity cb-gap-top">
      <span className="cb-field__label">キラフィルムを貼る個数（1 個につき +{price}円）</span>
      <div className="cb-quantity__controls">
        <Button
          variant="line"
          aria-label="キラフィルムの個数を減らす"
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
          aria-label="キラフィルムの個数を増やす"
          disabled={value >= quantity}
          onClick={() => onChange(Math.min(quantity, value + 1))}
        >
          ＋
        </Button>
      </div>
    </div>
  );
}
