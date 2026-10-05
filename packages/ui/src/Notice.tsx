import type { ReactNode } from "react";

/** お知らせとエラー。エラーは role="alert" で、読み上げにも届ける。「何が起きたか → どうするか」の順で書く */
export function Notice({
  tone = "info",
  children,
}: {
  tone?: "info" | "error";
  children: ReactNode;
}) {
  return (
    <div
      className={tone === "error" ? "cb-notice cb-notice--error" : "cb-notice"}
      role={tone === "error" ? "alert" : "status"}
    >
      {children}
    </div>
  );
}
