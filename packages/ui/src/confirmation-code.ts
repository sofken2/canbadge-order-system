import { CONFIRMATION_CODE_ALPHABET, CONFIRMATION_CODE_LENGTH } from "@canbadge/shared";

// 確認コード（4 文字）の入力の整形。スタッフの受け渡し（S04）と、来場者の注文照会（W04）の、両方で使う。

/**
 * 確認コードの入力を、整える。全角・小文字を直し、使わない文字（0 O 1 I L と記号・空白）は捨てる。
 * 4 文字までで切る。正しいかどうかの照合は、api が行う（ここは、入力の整形だけ）
 */
export function normalizeConfirmationCode(raw: string): string {
  const allowed = new Set(CONFIRMATION_CODE_ALPHABET);
  return [...raw.normalize("NFKC").toUpperCase()]
    .filter((char) => allowed.has(char))
    .slice(0, CONFIRMATION_CODE_LENGTH)
    .join("");
}

/** 4 文字そろっているか */
export const isCompleteCode = (code: string): boolean => code.length === CONFIRMATION_CODE_LENGTH;
