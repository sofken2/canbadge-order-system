import { useCallback, useEffect, useRef, useState } from "react";

// 画面で共通に使う、React の小さな部品。見た目（デザイントークン・部品）は T10 で決める。

export type Resource<T> = {
  data: T | undefined;
  /** 失敗したときの、画面に出せるメッセージ */
  error: string | undefined;
  loading: boolean;
  reload: () => void;
};

/**
 * データを読み込んで持つ。reload で読み直せる。
 * - subscribe を渡すと、SSE の通知（変わった、つながった）のたびに読み直す。
 *   SSE は「変わった」ことだけを知らせるので、正しい状態は、いつも REST で取り直す
 * - refreshMs を渡すと、一定間隔でも読み直す（SSE を使えない画面向け）
 */
export function useResource<T>(
  load: () => Promise<T>,
  options: {
    /** 読み直す条件。変わったら読み直す */
    deps?: readonly unknown[];
    subscribe?: (reload: () => void) => () => void;
    refreshMs?: number;
  } = {},
): Resource<T> {
  const [data, setData] = useState<T | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);
  const [loading, setLoading] = useState(true);

  // 最新の load と、読み込みの世代を覚えておく（古い応答で、新しい表示を上書きしないため）
  const loadRef = useRef(load);
  loadRef.current = load;
  const generation = useRef(0);

  const reload = useCallback(() => {
    const mine = ++generation.current;
    loadRef
      .current()
      .then((value) => {
        if (mine !== generation.current) return;
        setData(value);
        setError(undefined);
      })
      .catch((cause: unknown) => {
        if (mine !== generation.current) return;
        setError(cause instanceof Error ? cause.message : String(cause));
      })
      .finally(() => {
        if (mine === generation.current) setLoading(false);
      });
  }, []);

  useEffect(() => {
    setLoading(true);
    reload();
  }, [reload, ...(options.deps ?? [])]);

  const subscribe = options.subscribe;
  // biome-ignore lint/correctness/useExhaustiveDependencies: 購読は 1 回だけ張る
  useEffect(() => (subscribe ? subscribe(reload) : undefined), [reload, ...(options.deps ?? [])]);

  const refreshMs = options.refreshMs;
  useEffect(() => {
    if (!refreshMs) return undefined;
    const timer = setInterval(reload, refreshMs);
    return () => clearInterval(timer);
  }, [reload, refreshMs]);

  return { data, error, loading, reload };
}

/**
 * 操作（ボタンの押下）を実行する。実行中かどうかと、失敗のメッセージを持つ。
 * 成功したときは、結果を返し、失敗したときは undefined を返す（メッセージは error に入る）
 */
export function useAction<Args extends unknown[], R>(
  action: (...args: Args) => Promise<R>,
): {
  run: (...args: Args) => Promise<R | undefined>;
  running: boolean;
  error: string | undefined;
  clearError: () => void;
} {
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const run = useCallback(
    async (...args: Args) => {
      setRunning(true);
      setError(undefined);
      try {
        return await action(...args);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause));
        return undefined;
      } finally {
        setRunning(false);
      }
    },
    [action],
  );
  return { run, running, error, clearError: () => setError(undefined) };
}

/** いまの画面のパス。navigate で、ページを読み込み直さずに移動する（SPA） */
export function usePath(): string {
  const [path, setPath] = useState(window.location.pathname);
  useEffect(() => {
    const update = () => setPath(window.location.pathname);
    window.addEventListener("popstate", update);
    window.addEventListener("navigate", update);
    return () => {
      window.removeEventListener("popstate", update);
      window.removeEventListener("navigate", update);
    };
  }, []);
  return path;
}

export function navigate(path: string): void {
  window.history.pushState(null, "", path);
  window.dispatchEvent(new Event("navigate"));
}
