import { badgeSpec } from "@canbadge/badge-spec";
import { BadgeEditor, type BadgeEditorExport } from "@canbadge/editor";
import { BackButton } from "@canbadge/ui";
import { useEffect, useRef } from "react";
import { ORDER_DRAFT_KEY } from "./order-draft";
import "./tryon.css";

type TryOnProps = {
  onClose: () => void;
  onExport: (result: BadgeEditorExport) => void;
  /** 途中保存が変わった（絵が新しくなった・やり直しで消えた）とき。閉じたあとの保存でも呼ばれる */
  onDraftChange: (preview: Blob | undefined, saved: boolean) => void;
  /**
   * 開く前に選んだ写真。あれば、この写真で始める（途中保存の写真の代わり）。
   * なければ、途中保存の続きから始める
   */
  initialImage?: Blob;
  /** 決定のボタンの文字。注文に進むときと、はめてみるだけのときで変える */
  confirmLabel: string;
};

/**
 * はじめの画面の「画像をはめてみる」の中身。注文画面と同じエディタを使う。
 * 途中保存の名前も注文画面と同じなので、ここで作ったデザインは、注文画面を開くと、そのまま続きになる
 */
function TryOnEditor({ onClose, onExport, onDraftChange, initialImage, confirmLabel }: TryOnProps) {
  return (
    <>
      {/* 戻る（閉じる）は、全画面なので、ふつうの画面と同じく左上に置く */}
      <div className="cb-tryon__head">
        <BackButton className="cb-tryon__close" onClick={onClose} />
        {/*
         * 開いたときは、見出しにフォーカスを置く（最初のボタン＝戻るに置くと、開いた瞬間に枠が出て目立つ）。
         * 読み上げも、見出しから始まる
         */}
        <h2 id="cb-tryon-title" tabIndex={-1}>
          画像をはめてみる
        </h2>
      </div>
      <BadgeEditor
        spec={badgeSpec}
        draftKey={ORDER_DRAFT_KEY}
        onDraftChange={onDraftChange}
        initialImage={initialImage}
        confirmLabel={confirmLabel}
        // はじめの画面に本物の 3D があるので、エディタの中の 3D の完成予想は出さない
        preview3dEnabled={false}
        onExport={onExport}
      />
    </>
  );
}

/**
 * 画面いっぱいに重ねて開く（全画面）。PC は、左に編集中のデザイン（キャンバス）、右に操作のパネルを並べる（home.css）
 */
export function TryOnDialog({ open, ...props }: TryOnProps & { open: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      dialog.showModal();
      // 開くと、ブラウザは最初のボタン（戻る）にフォーカスを置く。見出しへ移す（理由は見出しのところ）
      dialog.querySelector<HTMLElement>("#cb-tryon-title")?.focus();
    }
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      className="cb-confirm cb-tryon cb-tryon--dialog"
      aria-labelledby="cb-tryon-title"
      // Esc で閉じたときも、呼ぶ側の状態を合わせる
      onCancel={(event) => {
        // 中に重ねた確認のダイアログの Esc では、閉じない（自分あての Esc だけ）
        if (event.target !== event.currentTarget) return;
        event.preventDefault();
        props.onClose();
      }}
    >
      {/* エディタは、開いている間だけつなぐ（閉じている間に、画面の大きさを測っても 0 になるため） */}
      {open && <TryOnEditor {...props} />}
    </dialog>
  );
}
