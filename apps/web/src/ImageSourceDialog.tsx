import { Button } from "@canbadge/ui";
import { useEffect, useRef } from "react";

/**
 * 「画像をはめてみる」を押したあとに出す、画像の取り込み元の選択。標準の <dialog> を使う（Esc で閉じる・フォーカスの閉じ込めは、ブラウザの仕事）。
 * Discord のアイコンは、api 側の設定がそろっているとき（discordEnabled）だけ選べる。呼ぶ側は、選べるのが 1 つだけなら、これを出さない
 */
export function ImageSourceDialog({
  open,
  onClose,
  onPickDevice,
  onPickDiscord,
}: {
  open: boolean;
  onClose: () => void;
  onPickDevice: () => void;
  onPickDiscord: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      dialog.showModal();
      // 開くと、ブラウザは最初のボタン（×）にフォーカスを置き、枠が出て目立つ。見出しへ移す
      dialog.querySelector<HTMLElement>("#cb-source-title")?.focus();
    }
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      className="cb-confirm cb-source"
      aria-labelledby="cb-source-title"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <button type="button" className="cb-source__close" aria-label="閉じる" onClick={onClose}>
        <svg
          viewBox="0 0 24 24"
          width="20"
          height="20"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          aria-hidden="true"
        >
          <path d="M6 6l12 12M18 6 6 18" />
        </svg>
      </button>
      <h2 id="cb-source-title" tabIndex={-1}>
        画像をえらぶ
      </h2>
      <div className="cb-source__actions">
        <Button variant="line" className="cb-source__tile" onClick={onPickDevice}>
          {/* 写真（山と太陽） */}
          <svg
            viewBox="0 0 24 24"
            width="28"
            height="28"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <rect x="3" y="4" width="18" height="16" rx="3" />
            <circle cx="9" cy="10" r="1.6" />
            <path d="m4 18 5-5 4 4 3-3 4 4" />
          </svg>
          デバイスの画像を使う
        </Button>
        <Button
          variant="line"
          className="cb-source__tile cb-source__tile--discord"
          onClick={onPickDiscord}
        >
          {/* Discord のロゴ */}
          <svg viewBox="0 0 24 24" width="28" height="28" fill="currentColor" aria-hidden="true">
            <path d="M20.317 4.3698a19.7913 19.7913 0 00-4.8851-1.5152.0741.0741 0 00-.0785.0371c-.211.3753-.4447.8648-.6083 1.2495-1.8447-.2762-3.68-.2762-5.4868 0-.1636-.3933-.4058-.8742-.6177-1.2495a.077.077 0 00-.0785-.037 19.7363 19.7363 0 00-4.8852 1.515.0699.0699 0 00-.0321.0277C.5334 9.0458-.319 13.5799.0992 18.0578a.0824.0824 0 00.0312.0561c2.0528 1.5076 4.0413 2.4228 5.9929 3.0294a.0777.0777 0 00.0842-.0276c.4616-.6304.8731-1.2952 1.226-1.9942a.076.076 0 00-.0416-.1057c-.6528-.2476-1.2743-.5495-1.8722-.8923a.077.077 0 01-.0076-.1277c.1258-.0943.2517-.1923.3718-.2914a.0743.0743 0 01.0776-.0105c3.9278 1.7933 8.18 1.7933 12.0614 0a.0739.0739 0 01.0785.0095c.1202.099.246.1981.3728.2924a.077.077 0 01-.0066.1276 12.2986 12.2986 0 01-1.873.8914.0766.0766 0 00-.0407.1067c.3604.698.7719 1.3628 1.225 1.9932a.076.076 0 00.0842.0286c1.961-.6067 3.9495-1.5219 6.0023-3.0294a.077.077 0 00.0313-.0552c.5004-5.177-.8382-9.6739-3.5485-13.6604a.061.061 0 00-.0312-.0286zM8.02 15.3312c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9555-2.4189 2.157-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.9555 2.4189-2.1569 2.4189zm7.9748 0c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9554-2.4189 2.1569-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.946 2.4189-2.1568 2.4189Z" />
          </svg>
          Discord のアイコンを使う
        </Button>
      </div>
    </dialog>
  );
}
