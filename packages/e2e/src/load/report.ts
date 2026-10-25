import type { LoadConfig } from "./config";
import {
  type EndpointStats,
  formatDuration,
  type Summary,
  summarize,
  summarizeCalls,
} from "./stats";
import { type OrderRecord, type Sample, STATUS_ORDER, stageIndex, type World } from "./world";

// 負荷テストの、結果の組み立て（Q04）。サーバーの最終的な状態と、模擬の記録を突き合わせ、
// 「どこが詰まるか」「人数・設定をどうするか」を、言葉にする。画面もネットワークも使わない、純粋な計算。

/** 実行のあと、サーバー（スタッフ用の API）から読み取った、最終的な状態 */
export type FinalState = {
  orders: { orderNumber: number; status: string }[];
  /** 1 個の価格（円） */
  price: number;
  sales: { paidCount: number; paidAmount: number; refundedCount: number; netAmount: number };
  sheets: {
    id: string;
    status: string;
    slots: { orderNumber: number; result: string }[];
  }[];
  /** 1 枚に載る数（面付け数） */
  slotsPerSheet: number;
};

export type Invariant = { name: string; ok: boolean; detail: string };

/** 流したあとに、必ず成り立つはずのこと。1 つでも崩れていたら、ずれ（バグ）の疑い */
export function checkInvariants(
  orders: readonly OrderRecord[],
  state: FinalState,
  context: { sseErrors: number },
): Invariant[] {
  const created = orders.filter((o) => o.orderNumber !== undefined);
  const numbers = state.orders.map((o) => o.orderNumber).sort((a, b) => a - b);
  const duplicates = numbers.length - new Set(numbers).size;
  const contiguous = numbers.every((n, i) => n === i + 1);

  const byNumber = new Map(state.orders.map((o) => [o.orderNumber, o.status]));
  const mismatches = created.filter((o) => {
    const dbStatus = byNumber.get(o.orderNumber ?? -1);
    if (dbStatus === undefined) return true;
    // 模擬が「ここまで進めた」と記録した状態より、サーバーの状態が遅れていたら、ずれ
    const reached = [...STATUS_ORDER].reverse().find((s) => o.at[s] !== undefined);
    if (reached === undefined) return false;
    if (o.reprinted && reached === "printed") return false;
    return stageIndex(dbStatus) < stageIndex(reached);
  });
  const finishedButNotPickedUp = orders.filter(
    (o) => o.finished && byNumber.get(o.orderNumber ?? -1) !== "picked_up",
  );

  const paidStatuses = new Set(["paid", "assembling", "ready", "picked_up"]);
  const paidInDb = state.orders.filter((o) => paidStatuses.has(o.status)).length;
  const printing = state.sheets.filter((s) => s.status === "printing");
  const oversize = state.sheets.filter((s) => s.slots.length > state.slotsPerSheet);
  const doubleOnSheet = state.sheets.filter(
    (s) => new Set(s.slots.map((x) => x.orderNumber)).size !== s.slots.length,
  );

  const failed = orders.filter((o) => o.failure);
  return [
    {
      name: "注文番号が、重複せず、1 から連番",
      ok: duplicates === 0 && contiguous,
      detail: `${numbers.length} 件・重複 ${duplicates}・連番 ${contiguous ? "あり" : "崩れている"}`,
    },
    {
      name: "模擬の来場者が出した注文が、すべてサーバーにある（取りこぼしがない）",
      ok: created.length === state.orders.length,
      detail: `模擬 ${created.length} 件 / サーバー ${state.orders.length} 件`,
    },
    {
      name: "サーバーの状態が、模擬の記録より、遅れていない",
      ok: mismatches.length === 0,
      detail:
        mismatches.length === 0
          ? "一致"
          : `${mismatches.length} 件がずれている（注文 ${mismatches
              .slice(0, 5)
              .map((o) => o.orderNumber)
              .join("、")}…）`,
    },
    {
      name: "受け渡しが済んだ注文は、サーバーでも「受け渡し済み」",
      ok: finishedButNotPickedUp.length === 0,
      detail: `${orders.filter((o) => o.finished).length} 件`,
    },
    {
      name: "売上の件数と金額が、支払い済みの注文と一致する",
      ok: state.sales.paidCount === paidInDb && state.sales.paidAmount === paidInDb * state.price,
      detail: `売上 ${state.sales.paidCount} 件・${state.sales.paidAmount} 円 / 注文 ${paidInDb} 件・${paidInDb * state.price} 円`,
    },
    {
      name: "印刷中のシートは、同時に 1 枚まで",
      ok: printing.length <= 1,
      detail: `印刷中 ${printing.length} 枚`,
    },
    {
      name: "1 枚のシートに、面付け数を超えて載っていない。同じ注文が、1 枚に 2 回載っていない",
      ok: oversize.length === 0 && doubleOnSheet.length === 0,
      detail: `超過 ${oversize.length} 枚・重複 ${doubleOnSheet.length} 枚`,
    },
    {
      name: "模擬の来場者・スタッフの作業が、エラーで止まっていない",
      ok: failed.length === 0,
      detail:
        failed.length === 0 ? "なし" : `${failed.length} 件（例: ${failed[0]?.failure ?? ""}）`,
    },
    {
      name: "SSE の接続が、エラーで切れていない",
      ok: context.sseErrors === 0,
      detail: `エラー ${context.sseErrors} 件`,
    },
  ];
}

export type StageTimes = {
  /** 支払い待ち：注文してから、支払い済みまで（歩く時間・レジの列を含む） */
  toPaid: Summary;
  /** 印刷待ち：支払い済みから、印刷の確認（組み立て待ち）まで */
  printWait: Summary;
  /** 組み立て待ち：確認から、組み立て開始まで */
  assemblyWait: Summary;
  /** 組み立ての作業：開始から、完成まで */
  assembleWork: Summary;
  /** 受け取り待ち：できあがりから、受け渡しまで */
  pickupWait: Summary;
  /** 注文から、受け渡しまで（来場者の、全体の待ち） */
  endToEnd: Summary;
};

function durations(
  orders: readonly OrderRecord[],
  from: keyof OrderRecord["at"],
  to: keyof OrderRecord["at"],
): number[] {
  return orders.flatMap((o) => {
    const a = o.at[from];
    const b = o.at[to];
    return a !== undefined && b !== undefined && b >= a ? [b - a] : [];
  });
}

export function stageTimes(orders: readonly OrderRecord[]): StageTimes {
  return {
    toPaid: summarize(durations(orders, "submitted", "paid")),
    printWait: summarize(durations(orders, "paid", "printed")),
    assemblyWait: summarize(durations(orders, "printed", "assembling")),
    assembleWork: summarize(durations(orders, "assembling", "ready")),
    pickupWait: summarize(durations(orders, "ready", "picked_up")),
    endToEnd: summarize(durations(orders, "submitted", "picked_up")),
  };
}

export type Capacity = {
  /** 各段階の、1 時間に処理できる数（バッジ）。いちばん小さい所が、全体の処理能力 */
  perHour: { cashier: number; print: number; assembly: number; pickup: number };
  bottleneck: "cashier" | "print" | "assembly" | "pickup";
  overallPerHour: number;
};

const STAGE_NAMES = {
  cashier: "レジ",
  print: "印刷（用紙とプリンター）",
  assembly: "組み立て",
  pickup: "受け渡し",
} as const;

/** 設定（人数・作業時間）から、理論上の処理能力を出す。待ち行列の、上限の目安 */
export function capacityOf(config: LoadConfig, slotsPerSheet: number): Capacity {
  const perHour = {
    cashier: (config.cashiers * 3600) / config.cashierServiceSeconds,
    // 用紙 1 枚を印刷する間に、シートの枚数分のバッジが進む。印刷中は、次のシートが出ない
    print: (slotsPerSheet * 3600) / config.printSeconds,
    assembly: (config.assemblers * 3600) / config.assembleServiceSeconds,
    pickup: (config.pickupStaff * 3600) / config.pickupServiceSeconds,
  };
  const entries = Object.entries(perHour) as [Capacity["bottleneck"], number][];
  const [bottleneck, overallPerHour] = entries.reduce((min, entry) =>
    entry[1] < min[1] ? entry : min,
  );
  return { perHour, bottleneck, overallPerHour };
}

export type Report = {
  config: LoadConfig;
  /** 実際にかかった時間（秒）と、仮想の分 */
  realSeconds: number;
  virtualMinutes: number;
  counts: {
    visitors: number;
    created: number;
    paid: number;
    printed: number;
    assembled: number;
    pickedUp: number;
    reprinted: number;
    failed: number;
  };
  /** 受け渡しまで終わった数を、仮想の 1 時間あたりにした値 */
  pickedUpPerHour: number;
  /** 来場者が来る速さ（1 時間あたり） */
  arrivalsPerHour: number;
  stages: StageTimes;
  utilization: Record<"cashier" | "assembler" | "pickup", number>;
  capacity: Capacity;
  sheets: { count: number; averageSlots: number; fillRate: number };
  peaks: {
    waitingPrint: number;
    waitingAssembly: number;
    ready: number;
    boothQueue: number;
    pickupQueue: number;
  };
  api: EndpointStats[];
  sse: { peak: number; errors: number; delayMs: Summary };
  /** 来場者の画面が最後に見た状態が、できあがり以降にならなかった数（SSE の取りこぼし） */
  sseMissed: number;
  expected: Record<string, number>;
  invariants: Invariant[];
  advice: string[];
};

/** 結果を、言葉にする。人数・設定の見直しの、たたき台 */
export function adviceFor(report: Omit<Report, "advice">): string[] {
  const { config, utilization, capacity, stages, sheets, counts } = report;
  const advice: string[] = [];
  const pct = (value: number) => `${Math.round(value * 100)}%`;

  const worst = (Object.entries(utilization) as [keyof typeof utilization, number][]).reduce(
    (a, b) => (b[1] > a[1] ? b : a),
  );
  const poolNames = {
    cashier: "レジ",
    assembler: "組み立て",
    pickup: "受け渡し",
  } as const;

  advice.push(
    `**ボトルネックは「${STAGE_NAMES[capacity.bottleneck]}」。** 理論上の処理能力は、1 時間に約 ${Math.floor(capacity.overallPerHour)} 個。来場者は、1 時間あたり約 ${Math.round(report.arrivalsPerHour)} 人のペースで来た`,
  );
  if (report.arrivalsPerHour > capacity.overallPerHour) {
    // 来場が続く間に、処理しきれず、たまる数（来場のペースと処理能力の差 × 続く時間）
    const backlog = Math.round(
      ((report.arrivalsPerHour - capacity.overallPerHour) * config.arrivalMinutes) / 60,
    );
    advice.push(
      `来場のペースが、処理能力を上回っている。**このペースが ${config.arrivalMinutes} 分続くと、終わりに、約 ${backlog} 個が未完成のまま残る**（計算）。受付を止める（ビジー）基準を決めておくか、${STAGE_NAMES[capacity.bottleneck]}の人数・作業の速さを見直す`,
    );
  }
  const people = {
    cashier: config.cashiers,
    assembler: config.assemblers,
    pickup: config.pickupStaff,
  };
  if (worst[1] >= 0.85) {
    advice.push(
      `${poolNames[worst[0]]}の稼働率が ${pct(worst[1])}。余裕がない。1 人増やすと（${people[worst[0]]} → ${people[worst[0]] + 1} 人）、その担当の処理能力は約 ${Math.round(((people[worst[0]] + 1) / people[worst[0]]) * 100)}% になる`,
    );
  } else if (worst[1] < 0.4) {
    advice.push(`最も忙しい担当でも、稼働率は ${pct(worst[1])}。人数に、余裕がある`);
  }
  if (Number.isFinite(stages.endToEnd.p95)) {
    advice.push(
      `来場者の待ち（注文から受け渡し）：中央値 ${formatDuration(stages.endToEnd.p50)}・95% の人が ${formatDuration(stages.endToEnd.p95)} 以内`,
    );
  }
  // 受付を止める目安：未完成の注文が、何件を超えたら、待ちが目標を超えるか
  const targets = [10, 20, 30];
  const limits = targets.map((minutes) => ({
    minutes,
    orders: Math.max(1, Math.floor((capacity.overallPerHour * minutes) / 60)),
  }));
  advice.push(
    `**受付を止める目安（ビジー）**：未完成の注文（支払い済み〜組み立て中）が、${limits
      .map((l) => `${l.orders} 件を超えると、待ちが約 ${l.minutes} 分`)
      .join("、")}（処理能力から、計算）`,
  );
  if (sheets.count > 0) {
    advice.push(
      `印刷：シート ${sheets.count} 枚・平均 ${sheets.averageSlots.toFixed(1)} 個/枚（${pct(sheets.fillRate)} 埋まった）。印刷を待つ最大の時間は ${config.printMaxWaitSeconds} 秒で、印刷待ちの平均は ${formatDuration(stages.printWait.mean)}。` +
        (sheets.fillRate < 0.5
          ? "用紙の埋まりが低い。来場が少ない時間帯は、待つ時間を長くすると、用紙が節約できる（その分、待ちは増える）"
          : sheets.fillRate < 0.8
            ? "用紙の埋まりは、ふつう。待つ時間を長くすると、もう少し節約できる（その分、待ちは増える）"
            : "用紙は、よく埋まっている"),
    );
  }
  if (counts.pickedUp < counts.visitors) {
    advice.push(
      `${counts.visitors - counts.pickedUp} 人が、時間内に、受け渡しまで終わらなかった。列が片づく前に、締め切りになった（人数を増やすか、受付を絞る）`,
    );
  }
  return advice;
}

/** 世界の記録と、サーバーの最終的な状態から、報告を組み立てる */
export function buildReport(world: World, state: FinalState, realSeconds: number): Report {
  const { config, orders } = world;
  const capacity = capacityOf(config, state.slotsPerSheet);
  const elapsedVirtual = realSeconds * config.speed;
  const count = (stage: keyof OrderRecord["at"]) =>
    orders.filter((o) => o.at[stage] !== undefined).length;
  const pickedUp = count("picked_up");
  const sheetCount = world.sheets.length;
  const totalSlots = world.sheets.reduce((sum, s) => sum + s.slots, 0);
  const sseDelays = orders.flatMap((o) => Object.values(o.sseDelayMs));
  const peak = (key: keyof Sample) => Math.max(0, ...world.samples.map((s) => s[key]));

  const util = (busy: number, people: number) =>
    elapsedVirtual > 0 ? busy / (people * elapsedVirtual) : 0;
  const partial: Omit<Report, "advice"> = {
    config,
    realSeconds,
    virtualMinutes: elapsedVirtual / 60,
    counts: {
      visitors: config.visitors,
      created: count("submitted"),
      paid: count("paid"),
      printed: count("printed"),
      assembled: count("assembling"),
      pickedUp,
      reprinted: orders.filter((o) => o.reprinted).length,
      failed: orders.filter((o) => o.failure).length,
    },
    pickedUpPerHour: elapsedVirtual > 0 ? (pickedUp / elapsedVirtual) * 3600 : 0,
    arrivalsPerHour: (config.visitors / config.arrivalMinutes) * 60,
    stages: stageTimes(orders),
    utilization: {
      cashier: util(world.busySeconds.cashier, config.cashiers),
      assembler: util(world.busySeconds.assembler, config.assemblers),
      pickup: util(world.busySeconds.pickup, config.pickupStaff),
    },
    capacity,
    sheets: {
      count: sheetCount,
      averageSlots: sheetCount > 0 ? totalSlots / sheetCount : 0,
      fillRate: sheetCount > 0 ? totalSlots / (sheetCount * state.slotsPerSheet) : 0,
    },
    peaks: {
      waitingPrint: peak("waitingPrint"),
      waitingAssembly: peak("waitingAssembly"),
      ready: peak("ready"),
      boothQueue: peak("boothQueue"),
      pickupQueue: peak("pickupQueue"),
    },
    api: summarizeCalls(world.calls),
    sse: { peak: world.sse.peak, errors: world.sse.errors, delayMs: summarize(sseDelays) },
    sseMissed: orders.filter(
      (o) =>
        o.finished &&
        (o.lastSeenStatus === undefined || stageIndex(o.lastSeenStatus) < stageIndex("ready")),
    ).length,
    expected: world.expected,
    invariants: checkInvariants(orders, state, { sseErrors: world.sse.errors }),
  };
  return { ...partial, advice: adviceFor(partial) };
}

/** 端末に出す、読みやすい報告 */
export function formatReport(report: Report): string {
  const lines: string[] = [];
  const s = (summary: Summary) =>
    Number.isFinite(summary.mean)
      ? `平均 ${formatDuration(summary.mean)}・中央値 ${formatDuration(summary.p50)}・95% ${formatDuration(summary.p95)}・最大 ${formatDuration(summary.max)}（${summary.count} 件）`
      : "（データなし）";
  const pct = (value: number) => `${Math.round(value * 100)}%`;
  const { counts, stages, config } = report;

  lines.push("=== 負荷テストの結果 ===");
  lines.push(
    `流した量：来場者 ${config.visitors} 人 / ${config.arrivalMinutes} 分（仮想）・時間の圧縮 ${config.speed} 倍 → 実際は ${report.realSeconds.toFixed(0)} 秒（仮想の ${report.virtualMinutes.toFixed(0)} 分）`,
  );
  lines.push(
    `人数：レジ ${config.cashiers}・組み立て ${config.assemblers}・受け渡し ${config.pickupStaff}（作業 ${config.cashierServiceSeconds}／${config.assembleServiceSeconds}／${config.pickupServiceSeconds} 秒）`,
  );
  lines.push("");
  lines.push("[件数]");
  lines.push(
    `  注文 ${counts.created} → 支払い ${counts.paid} → 印刷 ${counts.printed} → 組み立て ${counts.assembled} → 受け渡し ${counts.pickedUp}（再印刷 ${counts.reprinted}・失敗 ${counts.failed}）`,
  );
  lines.push(
    `  受け渡し：仮想の 1 時間あたり ${report.pickedUpPerHour.toFixed(0)} 個（来場のペース ${report.arrivalsPerHour.toFixed(0)} 人/時）`,
  );
  lines.push("");
  lines.push("[待ち時間（仮想の時間）]");
  lines.push(`  注文 → 支払い済み   ${s(stages.toPaid)}`);
  lines.push(`  印刷待ち           ${s(stages.printWait)}`);
  lines.push(`  組み立て待ち       ${s(stages.assemblyWait)}`);
  lines.push(`  組み立ての作業     ${s(stages.assembleWork)}`);
  lines.push(`  受け取り待ち       ${s(stages.pickupWait)}`);
  lines.push(`  注文 → 受け渡し    ${s(stages.endToEnd)}`);
  lines.push("");
  lines.push("[稼働率]");
  lines.push(
    `  レジ ${pct(report.utilization.cashier)}・組み立て ${pct(report.utilization.assembler)}・受け渡し ${pct(report.utilization.pickup)}`,
  );
  lines.push(
    `  理論上の処理能力（個/時）：レジ ${Math.floor(report.capacity.perHour.cashier)}・印刷 ${Math.floor(report.capacity.perHour.print)}・組み立て ${Math.floor(report.capacity.perHour.assembly)}・受け渡し ${Math.floor(report.capacity.perHour.pickup)}`,
  );
  lines.push(
    `  ピーク：レジの列 ${report.peaks.boothQueue}・印刷待ち ${report.peaks.waitingPrint}・組み立て待ち ${report.peaks.waitingAssembly}・できあがり ${report.peaks.ready}・受け渡しの列 ${report.peaks.pickupQueue}`,
  );
  lines.push("");
  lines.push("[サーバー（API）の応答時間 ms。呼ばれた多い順]");
  for (const e of report.api.slice(0, 12)) {
    const failures = Object.entries(e.failures)
      .map(([k, v]) => `${k}×${v}`)
      .join(" ");
    lines.push(
      `  ${e.label.padEnd(44)} ${String(e.count).padStart(5)} 回  p50 ${e.p50.toFixed(0).padStart(4)}  p95 ${e.p95.toFixed(0).padStart(4)}  p99 ${e.p99.toFixed(0).padStart(4)}  最大 ${e.max.toFixed(0).padStart(5)}${failures ? `  失敗: ${failures}` : ""}`,
    );
  }
  lines.push(
    `  SSE：同時の接続 最大 ${report.sse.peak}・エラー ${report.sse.errors}・操作から届くまで 中央値 ${report.sse.delayMs.p50.toFixed(0)}ms・p95 ${report.sse.delayMs.p95.toFixed(0)}ms・取りこぼし ${report.sseMissed}`,
  );
  if (Object.keys(report.expected).length > 0) {
    lines.push("");
    lines.push("[想定内の出来事]");
    for (const [name, n] of Object.entries(report.expected)) lines.push(`  ${name}: ${n} 回`);
  }
  lines.push("");
  lines.push("[整合性の確認]");
  for (const inv of report.invariants)
    lines.push(`  ${inv.ok ? "OK" : "NG"}  ${inv.name}（${inv.detail}）`);
  lines.push("");
  lines.push("[見直しのたたき台]");
  for (const a of report.advice) lines.push(`  ・${a.replaceAll("**", "")}`);
  return lines.join("\n");
}
