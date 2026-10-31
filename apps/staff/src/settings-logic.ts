import { type SalesResponse, type Setting, updateSettingRequestSchema } from "@canbadge/shared";

// 設定・売上集計画面の、画面から切り離した判定と計算（テストできるように）。

const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

/** 今日の日付（日本時間）。営業日の判定は、api（db）と同じく、日本時間で行う */
export function todayJst(nowMs: number): string {
  return new Date(nowMs + JST_OFFSET_MS).toISOString().slice(0, 10);
}

/** 営業日（YYYY-MM-DD）を「10月22日」に。学祭は数日なので、年は出さない。読めない文字は、そのまま返す */
export function businessDateLabel(date: string): string {
  const match = /^\d{4}-(\d{2})-(\d{2})$/.exec(date);
  if (!match) return date;
  return `${Number(match[1])}月${Number(match[2])}日`;
}

/**
 * 受付の一時停止（契約の acceptance が busy）の言い方。状態の表示名（「混雑のため一時停止中」）に合わせ、
 * ボタンとお知らせで、同じ言葉を使うよう、ここだけで持つ
 */
export const pauseCopy = {
  start: "受付を一時停止する",
  startNote: "新しい注文を止めます。支払い・印刷・受け渡しは続けられます。",
  started: "受付を一時停止しました。新しい注文は受け付けていません",
  resume: "一時停止を解除する",
  resumed: "一時停止を解除しました。受付中です",
} as const;

export type Impact = {
  title: string;
  confirmLabel: string;
  /** 何が起きるかを、1 行ずつ。実行の前に、確認の画面で見せる */
  lines: string[];
};

/**
 * 営業開始の影響。営業日が変わるときは、注文番号が 1 に戻り、前の営業日の支払い待ちは期限切れになる。
 * 同じ日にもう一度押したときは、受付を「受付中」に戻すだけ（注文番号は続き。支払い待ちも、そのまま）
 */
export function openDayImpact(input: {
  businessDate: string | null;
  today: string;
  submittedCount: number;
}): Impact {
  if (input.businessDate === input.today) {
    return {
      title: "受付を再開します",
      confirmLabel: "受付を再開する",
      lines: [
        `今日（${businessDateLabel(input.today)}）の営業は、すでに始まっています。`,
        "受付を「受付中」に戻します。注文番号は、続きから付きます。",
      ],
    };
  }
  const lines = [
    `営業日を ${businessDateLabel(input.today)}にし、受付を「受付中」にします。`,
    "注文番号は、1 番から付け直します。",
  ];
  if (input.submittedCount > 0) {
    lines.push(
      `支払い待ちの注文 ${input.submittedCount} 件は、期限切れになります（お客さんは、もう一度、注文が必要です）。`,
    );
  }
  lines.push("この操作は、取り消せません。");
  return { title: "営業を開始します", confirmLabel: "営業を開始する", lines };
}

/** 受付終了の影響。当日の支払い待ちは、すべて期限切れになる */
export function closeImpact(submittedCount: number): Impact {
  const lines = [
    "新しい注文を、受け付けなくなります。支払い済みの注文の印刷・受け渡しは、続けられます。",
  ];
  if (submittedCount > 0) {
    lines.push(
      `支払い待ちの注文 ${submittedCount} 件は、期限切れになります。レジで、支払いを済ませてから、押してください。`,
    );
  }
  // 押すボタンの名前は、画面の実際のラベルと一字一句そろえる（違うと、探しても見つからない）
  lines.push(
    "この操作は、取り消せません。",
    "もう一度受け付けるには『受付を再開する』を押します（翌日は『営業を開始する』）。",
  );
  return { title: "受付を終了します", confirmLabel: "受付を終了する", lines };
}

// ---- 設定の編集 ----

/** 画面で編集する値を、入力欄の文字として持つ（途中の入力を、そのまま持てるように）。容量は MB で見せる */
export type SettingsForm = {
  price: string;
  kiraFilmPrice: string;
  magnetPrice: string;
  badgeStock: string;
  kiraShardsStock: string;
  kiraAuroraStock: string;
  magnetStock: string;
  maxQuantityPerOrder: string;
  maxPendingPerDevice: string;
  printMaxWaitSeconds: string;
  orderNumberDigits: string;
  imageMaxMb: string;
};

export type FormField = keyof SettingsForm;

const MB = 1024 * 1024;

export function formFromSetting(setting: Setting): SettingsForm {
  return {
    price: String(setting.price),
    kiraFilmPrice: String(setting.kiraFilmPrice),
    magnetPrice: String(setting.magnetPrice),
    badgeStock: String(setting.badgeStock),
    kiraShardsStock: String(setting.kiraShardsStock),
    kiraAuroraStock: String(setting.kiraAuroraStock),
    magnetStock: String(setting.magnetStock),
    maxQuantityPerOrder: String(setting.maxQuantityPerOrder),
    maxPendingPerDevice: String(setting.maxPendingPerDevice),
    printMaxWaitSeconds: String(setting.printMaxWaitSeconds),
    orderNumberDigits: String(setting.orderNumberDigits),
    imageMaxMb: String(Math.round((setting.imageMaxBytes / MB) * 10) / 10),
  };
}

/** 数字だけの文字（全角も可）を、整数にする。数字以外が混ざる・空・桁あふれは undefined */
export function parseInteger(raw: string): number | undefined {
  const text = raw.normalize("NFKC").replace(/[,\s]/g, "");
  if (!/^\d{1,9}$/.test(text)) return undefined;
  return Number(text);
}

/** 欄の名前。入力欄のラベルとエラーの文で同じ名前を使うよう、ここだけで決める */
export const FIELD_LABELS: Record<FormField, string> = {
  price: "価格（1 個）",
  kiraFilmPrice: "キラフィルムの加算額（1 個）",
  magnetPrice: "マグネット加工の加算額（1 個）",
  badgeStock: "バッジの在庫（総数）",
  kiraShardsStock: "キラフィルム（割れガラス）の在庫（総数）",
  kiraAuroraStock: "キラフィルム（オーロラ）の在庫（総数）",
  magnetStock: "マグネットの在庫（総数）",
  maxQuantityPerOrder: "1 注文の個数の上限",
  maxPendingPerDevice: "1 台あたりの支払い待ちの上限",
  printMaxWaitSeconds: "印刷を待つ最大の秒数",
  orderNumberDigits: "注文番号の桁数",
  imageMaxMb: "画像の容量の上限",
};

export type ParsedForm =
  | { ok: true; value: ReturnType<typeof updateSettingRequestSchema.parse> }
  | { ok: false; errors: Partial<Record<FormField, string>> };

/** 入力を検証して、api に送る値にする。範囲は契約（shared）が持ち、ここは、入力の文字を数にして、契約に通す */
export function parseSettingsForm(form: SettingsForm): ParsedForm {
  const errors: Partial<Record<FormField, string>> = {};
  const numbers: Partial<Record<FormField, number>> = {};
  for (const field of Object.keys(form) as FormField[]) {
    if (field === "imageMaxMb") {
      const raw = form[field].normalize("NFKC").trim();
      const mb = Number(raw);
      if (raw === "" || !Number.isFinite(mb) || mb <= 0 || mb > 1000) {
        errors[field] = `${FIELD_LABELS[field]}は、0 より大きい数（MB）で入れてください`;
      } else {
        numbers[field] = Math.round(mb * MB);
      }
      continue;
    }
    const value = parseInteger(form[field]);
    if (value === undefined) errors[field] = `${FIELD_LABELS[field]}は、数字で入れてください`;
    else numbers[field] = value;
  }
  if (Object.keys(errors).length > 0) return { ok: false, errors };

  const result = updateSettingRequestSchema.safeParse({
    price: numbers.price,
    kiraFilmPrice: numbers.kiraFilmPrice,
    magnetPrice: numbers.magnetPrice,
    badgeStock: numbers.badgeStock,
    kiraShardsStock: numbers.kiraShardsStock,
    kiraAuroraStock: numbers.kiraAuroraStock,
    magnetStock: numbers.magnetStock,
    maxQuantityPerOrder: numbers.maxQuantityPerOrder,
    maxPendingPerDevice: numbers.maxPendingPerDevice,
    printMaxWaitSeconds: numbers.printMaxWaitSeconds,
    orderNumberDigits: numbers.orderNumberDigits,
    imageMaxBytes: numbers.imageMaxMb,
  });
  if (result.success) return { ok: true, value: result.data };

  for (const issue of result.error.issues) {
    const key = issue.path[0];
    const field: FormField | undefined =
      key === "imageMaxBytes" ? "imageMaxMb" : (key as FormField | undefined);
    if (field && field in FIELD_LABELS && !errors[field]) {
      errors[field] =
        field === "orderNumberDigits"
          ? "注文番号の桁数は、1〜6 で入れてください"
          : `${FIELD_LABELS[field]}は、1 以上の整数で入れてください`;
    }
  }
  return { ok: false, errors };
}

/** 保存済みの値と、入力が違うか（変えていないのに、保存を押せないように） */
export function formChanged(form: SettingsForm, setting: Setting): boolean {
  const saved = formFromSetting(setting);
  return (Object.keys(saved) as FormField[]).some((field) => form[field].trim() !== saved[field]);
}

// ---- 売上 ----

/** 「9 時台」 */
export const hourLabel = (hour: number): string => `${hour} 時台`;

/** 棒グラフの長さ（0〜1）。最大の時間帯を 1 とする */
export function barRatio(amount: number, max: number): number {
  return max > 0 ? Math.min(1, amount / max) : 0;
}

/** 時間帯を、早い順に。棒の長さの基準になる最大額も返す */
export function hourlyRows(sales: SalesResponse): {
  rows: (SalesResponse["hourly"][number] & { ratio: number })[];
  max: number;
} {
  const sorted = [...sales.hourly].sort((a, b) => a.hour - b.hour);
  const max = Math.max(0, ...sorted.map((row) => row.paidAmount));
  return { rows: sorted.map((row) => ({ ...row, ratio: barRatio(row.paidAmount, max) })), max };
}
