let probe: CanvasRenderingContext2D | null | undefined;

/**
 * トークン（CSS 変数）の色を、キャンバスに描ける色にする。キャンバスは CSS 変数を直接読めないので、
 * 描く前にここで値を取り出す。変数がない・解釈できない色のときは、fallback を返す
 */
export function resolveColor(name: string, fallback: string): string {
  if (typeof document === "undefined") return fallback;
  const raw = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  if (!raw) return fallback;
  probe ??= document.createElement("canvas").getContext("2d");
  if (!probe) return fallback;
  // 解釈できない色を代入すると、値は変わらない。いったん別の色にして、変わったかで確かめる
  probe.fillStyle = "#000001";
  probe.fillStyle = raw;
  const resolved = String(probe.fillStyle);
  return resolved === "#000001" && raw !== "#000001" ? fallback : resolved;
}
