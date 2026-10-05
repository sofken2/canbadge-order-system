import type { ButtonHTMLAttributes } from "react";

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  /** primary は珊瑚（1画面に1つまで）、line は輪郭だけ、ink は黒地 */
  variant?: "primary" | "line" | "ink";
  /** large はスタッフの主操作用（高さ 3.75rem） */
  size?: "medium" | "large";
  block?: boolean;
};

export function Button({
  variant = "primary",
  size = "medium",
  block = false,
  className,
  type = "button",
  ...rest
}: ButtonProps) {
  const classes = [
    "cb-button",
    variant === "primary" ? undefined : `cb-button--${variant}`,
    size === "large" ? "cb-button--large" : undefined,
    block ? "cb-button--block" : undefined,
    className,
  ];
  return <button type={type} className={classes.filter(Boolean).join(" ")} {...rest} />;
}
