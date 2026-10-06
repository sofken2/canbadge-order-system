import { useEffect, useState } from "react";

/** 現在時刻（ms）。経過時間の表示を、一定の間隔で更新するため。active が false の間は、更新しない */
export function useNow(intervalMs: number, active = true): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs, active]);
  return now;
}
