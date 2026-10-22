import { type ReactNode, useEffect, useRef } from "react";
import { Button } from "./Button";

/**
 * 実行前の確認。標準の <dialog> を使う（フォーカスの閉じ込めと Esc での取り消しが、ブラウザの仕事になる）。
 * 取り消せない・影響の大きい操作の前に出す。何が起きるかを、本文で、具体的に書く
 */
export function ConfirmDialog({
  open,
  title,
  children,
  confirmLabel,
  cancelLabel = "やめる",
  running = false,
  error,
  onConfirm,
  onCancel,
  onDismiss = onCancel,
}: {
  open: boolean;
  title: string;
  children: ReactNode;
  confirmLabel: string;
  /** 取り消し側のボタンの文字。取り消しが「別の操作をする」になるときに変える */
  cancelLabel?: string;
  running?: boolean;
  error?: string | undefined;
  onConfirm: () => void;
  onCancel: () => void;
  /** Esc で閉じたとき。省略すると onCancel（取り消しのボタンが別の操作をするときは、ただ閉じるだけにする） */
  onDismiss?: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      className="cb-confirm"
      aria-labelledby="cb-confirm-title"
      // Esc で閉じたときも、呼ぶ側の状態を合わせる
      onCancel={(event) => {
        event.preventDefault();
        // 別のダイアログの中に置いたとき、外側まで閉じないように
        event.stopPropagation();
        if (!running) onDismiss();
      }}
    >
      <h2 id="cb-confirm-title">{title}</h2>
      <div className="cb-confirm__body">{children}</div>
      {error && (
        <p role="alert" className="cb-confirm__error">
          {error}
        </p>
      )}
      <div className="cb-confirm__actions">
        <Button variant="line" size="large" onClick={onCancel} disabled={running}>
          {cancelLabel}
        </Button>
        <Button size="large" onClick={onConfirm} disabled={running}>
          {confirmLabel}
        </Button>
      </div>
    </dialog>
  );
}
