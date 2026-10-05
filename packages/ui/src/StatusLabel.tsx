export type StatusTone = "neutral" | "active" | "done";

/** 状態の表示。色だけで区別しないよう、文字は必ず渡す。表示名は @canbadge/shared の *Labels を使う */
export function StatusLabel({ label, tone = "neutral" }: { label: string; tone?: StatusTone }) {
  return (
    <span className={tone === "neutral" ? "cb-status" : `cb-status cb-status--${tone}`}>
      {label}
    </span>
  );
}
