import { useEffect, useState } from "react";

/**
 * active が、ms の間つづいたときだけ true にする。すぐ true に戻ったときは、true にならない。
 * 一瞬の通信の失敗（再接続・画面を戻した直後など）を、エラーとして見せないために使う
 */
export function useDelayedFlag(active: boolean, ms: number): boolean {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    if (!active) {
      setShown(false);
      return undefined;
    }
    const timer = setTimeout(() => setShown(true), ms);
    return () => clearTimeout(timer);
  }, [active, ms]);
  return shown;
}
