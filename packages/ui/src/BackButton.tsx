import type { ButtonHTMLAttributes } from "react";

/**
 * 左上に置く「← 戻る」。矢印と文字の、控えめなボタン（見出しや主ボタンと張り合わない）。
 * 全画面の編集画面と、はじめの画面から入る各画面（注文・注文状況・注文を開く・作品）の左上で使う
 */
export function BackButton({
  className,
  type = "button",
  children = "戻る",
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button type={type} className={["cb-back", className].filter(Boolean).join(" ")} {...rest}>
      <svg
        viewBox="0 0 24 24"
        width="20"
        height="20"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M15 6l-6 6 6 6" />
      </svg>
      {children}
    </button>
  );
}
