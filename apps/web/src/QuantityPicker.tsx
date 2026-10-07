import { Button } from "@canbadge/ui";

/**
 * 個数の選択（−／＋）。上限が 1 のときは、何も出さない（選ぶ必要がない）。
 * 通常の注文と、作品からの注文（W07）で、同じものを使う
 */
export function QuantityPicker({
  value,
  max,
  onChange,
}: {
  value: number;
  max: number;
  onChange: (next: number) => void;
}) {
  if (max <= 1) return null;
  return (
    <div className="cb-quantity cb-gap-top">
      <span className="cb-field__label">個数</span>
      <div className="cb-quantity__controls">
        <Button
          variant="line"
          aria-label="個数を減らす"
          disabled={value <= 1}
          onClick={() => onChange(Math.max(1, value - 1))}
        >
          −
        </Button>
        <output className="cb-quantity__value" aria-live="polite">
          {value} 個
        </output>
        <Button
          variant="line"
          aria-label="個数を増やす"
          disabled={value >= max}
          onClick={() => onChange(Math.min(max, value + 1))}
        >
          ＋
        </Button>
      </div>
    </div>
  );
}
