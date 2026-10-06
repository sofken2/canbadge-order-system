import type { InputHTMLAttributes, ReactNode, Ref } from "react";

export type FieldProps = Omit<InputHTMLAttributes<HTMLInputElement>, "className"> & {
  /** ラベルは常に見せる（placeholder をラベルの代わりにしない） */
  label: ReactNode;
  hint?: ReactNode;
  /** スタッフが番号を入れる、大きな下線だけの入力欄 */
  numeric?: boolean;
  /** 入力欄の参照（ハンディスキャナーの入力のために、画面が、入力欄へ移すとき） */
  ref?: Ref<HTMLInputElement>;
};

export function TextField({ label, hint, numeric = false, ref, ...rest }: FieldProps) {
  return (
    <label className="cb-field">
      <span className="cb-field__label">{label}</span>
      <input ref={ref} className={numeric ? "cb-input cb-input--number" : "cb-input"} {...rest} />
      {hint && <span className="cb-field__hint">{hint}</span>}
    </label>
  );
}

export type CheckboxProps = Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "className"> & {
  label: ReactNode;
};

export function Checkbox({ label, ...rest }: CheckboxProps) {
  return (
    <label className="cb-check">
      <input type="checkbox" {...rest} />
      <span>{label}</span>
    </label>
  );
}
