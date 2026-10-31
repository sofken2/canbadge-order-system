import { KIRA_PATTERNS, type KiraPattern, type KiraRemaining } from "./kira-pattern";
import "./kira-pattern.css";

/**
 * キラフィルムの柄の選択（キラフィルムを付けたときだけ出す）。中身はラジオボタンで、見た目は丸い札。
 * 柄は注文に記録され、在庫は柄ごとに数える。売り切れの柄は、選べない
 */
export function KiraPatternPicker({
  value,
  remaining,
  onChange,
}: {
  value: KiraPattern;
  /** 柄ごとの在庫の残り。読めないあいだは、すべて選べる */
  remaining: KiraRemaining | undefined;
  onChange: (next: KiraPattern) => void;
}) {
  return (
    <fieldset className="cb-kira-pattern">
      <legend className="cb-field__label">キラフィルムの柄</legend>
      <div className="cb-kira-pattern__choices">
        {KIRA_PATTERNS.map((pattern) => {
          const soldOut = remaining !== undefined && remaining[pattern.id] <= 0;
          return (
            <label key={pattern.id} className="cb-kira-pattern__choice">
              <input
                type="radio"
                name="kira-pattern"
                value={pattern.id}
                checked={value === pattern.id}
                disabled={soldOut}
                onChange={() => onChange(pattern.id)}
              />
              {pattern.label}
              {soldOut && "（売り切れ）"}
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
