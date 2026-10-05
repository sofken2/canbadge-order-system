import { CONFIRMATION_CODE_ALPHABET, CONFIRMATION_CODE_LENGTH } from "@canbadge/shared";
import { monotonicFactory } from "ulid";

// 同じミリ秒に作った ID も、作った順に並ぶ ULID にする（操作ログの順序などに使う）
const nextUlid = monotonicFactory();

/** 新しい ID（ULID）。時刻を渡すと、その時刻の ID になる（テストやサンプルデータで時刻を固定するため） */
export function newId(at: Date = new Date()): string {
  return nextUlid(at.getTime());
}

const randomByte = (): number => crypto.getRandomValues(new Uint8Array(1))[0] ?? 0;

/**
 * 確認コードを作る。紛らわしい文字を除いた 31 文字から選ぶ。
 * 256 を 31 で割った余りの分は捨てて引き直し、特定の文字が出やすくならないようにする
 */
export function generateConfirmationCode(nextByte: () => number = randomByte): string {
  const size = CONFIRMATION_CODE_ALPHABET.length;
  const limit = 256 - (256 % size);
  let code = "";
  while (code.length < CONFIRMATION_CODE_LENGTH) {
    const byte = nextByte();
    if (byte >= limit) continue;
    code += CONFIRMATION_CODE_ALPHABET.charAt(byte % size);
  }
  return code;
}
