import type { StaffOrderView } from "@canbadge/shared";
import { useCallback, useEffect, useRef, useState } from "react";

// 支払い済みの「取り消せる時間」。押し間違いに対応するため、押してから一定時間は、まだ支払いを確定させない。
// 状態遷移表には、支払い済みから支払い待ちに戻す遷移がない（契約）。そのため、確定を遅らせて、その間に取り消せるようにする。
// 次の注文を支払い済みにするとき、そのほかの画面を離れるときは、待たずに、すぐ確定する。

export type PendingPayment = {
  order: StaffOrderView;
  /** 確定する時刻（Date.now() の値） */
  deadline: number;
  /** 画面に出す、お釣りの額（確定には使わない） */
  change: number;
};

/** 取り消せる時間（ms） */
export const UNDO_WINDOW_MS = 5000;

export function usePendingPayment(options: {
  /** 実際に、支払い済みにする。失敗したら、投げる */
  commit: (order: StaffOrderView) => Promise<void>;
  /** 画面を閉じるとき、待たずに確定する。応答を待てないので、keepalive で送る */
  commitOnLeave: (order: StaffOrderView) => void;
  onCommitted: (order: StaffOrderView, change: number) => void;
  onFailed: (order: StaffOrderView, message: string) => void;
}) {
  const [pending, setPending] = useState<PendingPayment | undefined>(undefined);
  const pendingRef = useRef<PendingPayment | undefined>(undefined);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const callbacks = useRef(options);
  callbacks.current = options;

  const set = useCallback((next: PendingPayment | undefined) => {
    pendingRef.current = next;
    setPending(next);
  }, []);

  /** いま待っている支払いを、すぐ確定する */
  const flush = useCallback(async () => {
    const current = pendingRef.current;
    if (!current) return;
    clearTimeout(timer.current);
    set(undefined);
    try {
      await callbacks.current.commit(current.order);
      callbacks.current.onCommitted(current.order, current.change);
    } catch (error) {
      callbacks.current.onFailed(
        current.order,
        error instanceof Error ? error.message : String(error),
      );
    }
  }, [set]);

  /** 支払い済みにする操作。取り消せる時間を始める。前に待っていた支払いは、先に確定する */
  const start = useCallback(
    async (order: StaffOrderView, change: number) => {
      await flush();
      const next = { order, change, deadline: Date.now() + UNDO_WINDOW_MS };
      set(next);
      timer.current = setTimeout(() => void flush(), UNDO_WINDOW_MS);
    },
    [flush, set],
  );

  /** 取り消す。支払いは、なかったことになる（注文は、支払い待ちのまま） */
  const undo = useCallback(() => {
    clearTimeout(timer.current);
    set(undefined);
  }, [set]);

  // 画面を閉じる・別のページへ移るときは、待っている支払いを確定する（確定を忘れないため）
  useEffect(() => {
    const onLeave = () => {
      const current = pendingRef.current;
      if (current) callbacks.current.commitOnLeave(current.order);
    };
    window.addEventListener("pagehide", onLeave);
    return () => {
      window.removeEventListener("pagehide", onLeave);
      clearTimeout(timer.current);
      // この画面の中で、別のスタッフ画面に移ったとき（SPA）も、確定する
      const current = pendingRef.current;
      if (current) callbacks.current.commitOnLeave(current.order);
    };
  }, []);

  return { pending, start, undo, flush };
}
