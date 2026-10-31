import { orderStatusLabels, type PrintedItemView } from "@canbadge/shared";
import { Button, Notice, StatusLabel, TextField, useAction } from "@canbadge/ui";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "./api";
import "./printed-gallery.css";

const PAGE_SIZE = 60;

const dateTime = (iso: string): string =>
  new Date(iso).toLocaleString("ja-JP", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

/** 縮小版の URL から、元の画像の URL にする（縮小版は ?size=thumb がついている） */
const fullImageUrl = (thumbnailUrl: string): string => thumbnailUrl.replace(/\?size=thumb$/, "");

/** 大きく表示する。右上の × か、外側のクリックか、Esc で閉じる */
function PreviewDialog({ item, onClose }: { item: PrintedItemView; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);

  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: 外側のクリックで閉じるのは、マウス向けの近道。キーボードは Esc か ×
    <dialog
      ref={ref}
      className="cb-gallery__dialog"
      aria-label={`注文 ${item.orderNumberText} のバッジ`}
      onClose={onClose}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <button type="button" className="cb-gallery__close" aria-label="閉じる" onClick={onClose}>
        ×
      </button>
      <img src={fullImageUrl(item.thumbnailUrl)} alt="印刷したバッジのデザイン" />
      <p className="cb-number cb-number--medium">{item.orderNumberText}</p>
      <p className="cb-muted">
        {orderStatusLabels[item.orderStatus]}・{item.printCount} 回印刷・最後に{" "}
        {dateTime(item.lastPrintedAt)}
      </p>
    </dialog>
  );
}

/**
 * 印刷済みバッジの一覧（プレビュー）。これまでに印刷した全バッジを、新しい順に並べて見る。
 * 見るだけで、再印刷などの操作はしない（再印刷は「印刷」画面）。
 * スタッフ用の画面なので、来場者には出ない（/api/staff/* と同じ守り）
 */
export function PrintedGalleryPage() {
  const [query, setQuery] = useState("");
  const [applied, setApplied] = useState("");
  const [items, setItems] = useState<readonly PrintedItemView[]>([]);
  const [nextBefore, setNextBefore] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [opened, setOpened] = useState<PrintedItemView | undefined>(undefined);

  const first = useAction(
    useCallback(async () => {
      const page = await api.call("listPrintedItems", {
        query: { ...(applied ? { q: applied } : {}), limit: PAGE_SIZE },
      });
      setItems(page.items);
      setNextBefore(page.nextBefore ?? null);
      setLoaded(true);
    }, [applied]),
  );
  const more = useAction(async () => {
    if (!nextBefore) return;
    const page = await api.call("listPrintedItems", {
      query: { ...(applied ? { q: applied } : {}), before: nextBefore, limit: PAGE_SIZE },
    });
    // 読み込みの間に増えた分で、同じバッジが重なることがある
    setItems((current) => {
      const seen = new Set(current.map((item) => item.orderItemId));
      return [...current, ...page.items.filter((item) => !seen.has(item.orderItemId))];
    });
    setNextBefore(page.nextBefore ?? null);
  });

  // 検索の条件が変わったら、最初から読み直す
  // biome-ignore lint/correctness/useExhaustiveDependencies: first.run は毎回変わる。条件の変更だけで読み直す
  useEffect(() => {
    void first.run();
  }, [applied]);

  return (
    <main className="cb-page cb-gallery">
      <h1>印刷済みバッジ</h1>
      <p className="cb-muted">
        これまでに印刷した全部のバッジを、新しい順に見られます。タップで大きく表示します。
      </p>

      <form
        className="cb-gallery__search"
        onSubmit={(event) => {
          event.preventDefault();
          setApplied(query.trim());
        }}
      >
        <TextField
          numeric
          label="注文番号"
          hint="空のまま探すと、すべて出ます"
          value={query}
          inputMode="numeric"
          autoComplete="off"
          onChange={(event) => setQuery(event.target.value)}
        />
        <Button type="submit" variant="ink" size="large" block>
          探す
        </Button>
      </form>

      {first.error && <Notice tone="error">{first.error}</Notice>}
      {loaded && items.length === 0 && (
        <p className="cb-muted">
          {applied
            ? `「${applied}」の印刷済みのバッジはありません。`
            : "印刷済みのバッジはまだありません。"}
        </p>
      )}

      <ul className="cb-gallery__grid">
        {items.map((item) => (
          <li key={item.orderItemId}>
            <button
              type="button"
              className="cb-gallery__tile"
              onClick={() => setOpened(item)}
              aria-label={`注文 ${item.orderNumberText} のバッジを大きく見る`}
            >
              <img src={item.thumbnailUrl} alt="" loading="lazy" />
              <span className="cb-number cb-number--medium">{item.orderNumberText}</span>
              <StatusLabel label={orderStatusLabels[item.orderStatus]} tone="neutral" />
            </button>
          </li>
        ))}
      </ul>

      {more.error && <Notice tone="error">{more.error}</Notice>}
      {nextBefore && (
        <Button
          variant="line"
          size="large"
          block
          onClick={() => void more.run()}
          disabled={more.running}
        >
          さらに読み込む
        </Button>
      )}

      {opened && <PreviewDialog item={opened} onClose={() => setOpened(undefined)} />}
    </main>
  );
}
