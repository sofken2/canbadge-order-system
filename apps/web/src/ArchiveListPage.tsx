import type { ArchiveEntryView } from "@canbadge/shared";
import { Button, Notice, navigate } from "@canbadge/ui";
import { useCallback, useEffect, useState } from "react";
import { api } from "./api";
import "./archive.css";
import { appendPage, PAGE_SIZE } from "./archive-view-logic";

/**
 * みんなの作品（W05）。公開中の作品を、サムネイルで、新しい順に並べる。
 * 件数が増えても重くならないよう、サムネイル（小さい画像）を使い、ページ送り（「もっと見る」）にする
 */
export function ArchiveListPage() {
  const [items, setItems] = useState<ArchiveEntryView[]>([]);
  const [nextBefore, setNextBefore] = useState<string | null | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | undefined>(undefined);

  const load = useCallback(async (before?: string) => {
    setLoading(true);
    setError(undefined);
    try {
      const page = await api.call("listArchive", {
        query: { limit: PAGE_SIZE, ...(before ? { before } : {}) },
      });
      setItems((current) => (before ? appendPage(current, page.items) : page.items));
      setNextBefore(page.nextBefore);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const empty = !loading && !error && items.length === 0;

  return (
    <main className="cb-page">
      <h1>みんなの作品</h1>
      <p className="cb-muted">
        他のお客さんが、公開してくれた作品です。気に入った作品は、同じバッジを、注文できます。
      </p>

      {error && <Notice tone="error">{error}</Notice>}
      {empty && (
        <p className="cb-muted">
          まだ、公開されている作品は、ありません。最初の 1 点に、なりませんか？
        </p>
      )}

      <ul className="cb-gallery">
        {items.map((entry) => (
          <li key={entry.id}>
            <a
              href={`/archive/${entry.id}`}
              className="cb-gallery__item"
              onClick={(event) => {
                event.preventDefault();
                navigate(`/archive/${entry.id}`);
              }}
            >
              {/* 幅と高さを決めておく（読み込み中に、並びが動かないように）。画面の外は、あとで読む */}
              <img
                src={entry.thumbnailUrl}
                alt=""
                width={256}
                height={256}
                loading="lazy"
                className="cb-gallery__thumb"
              />
              <span className="cb-gallery__name">{entry.displayName}</span>
            </a>
          </li>
        ))}
      </ul>

      {nextBefore && (
        <Button variant="line" block disabled={loading} onClick={() => void load(nextBefore)}>
          {loading ? "読み込んでいます…" : "もっと見る"}
        </Button>
      )}
      {loading && items.length === 0 && <p className="cb-muted">読み込んでいます…</p>}

      <div className="cb-gap-top">
        <Button block size="large" onClick={() => navigate("/archive/post")}>
          作品を、投稿する
        </Button>
        <Button variant="line" block onClick={() => navigate("/")}>
          バッジを注文する
        </Button>
      </div>
    </main>
  );
}
