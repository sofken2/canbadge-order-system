import { KIRA_PATTERNS, type KiraPattern } from "./kira-pattern";
import "./kira-pattern.css";

/**
 * キラフィルムの柄の選択（キラフィルムを付けたときだけ出す）。中身はラジオボタンで、見た目は丸い札。
 * 柄は、まだ注文に記録できない（契約に項目がない）ので、レジで伝えてもらう。
 * 注文状況の画面には、この端末に残した柄を出す（kira-pattern.ts）。契約に入ったら、注文に載せる
 */
export function KiraPatternPicker({
  value,
  onChange,
}: {
  value: KiraPattern;
  onChange: (next: KiraPattern) => void;
}) {
  return (
    <fieldset className="cb-kira-pattern">
      <legend className="cb-field__label">キラフィルムの柄</legend>
      <div className="cb-kira-pattern__choices">
        {KIRA_PATTERNS.map((pattern) => (
          <label key={pattern.id} className="cb-kira-pattern__choice">
            <input
              type="radio"
              name="kira-pattern"
              value={pattern.id}
              checked={value === pattern.id}
              onChange={() => onChange(pattern.id)}
            />
            {pattern.label}
          </label>
        ))}
      </div>
      <p className="cb-muted">柄は、ブースのレジでお伝えください。</p>
    </fieldset>
  );
}
