import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type BadgeSpec, badgeSpec, mmToPt, printDiameterMm } from "@canbadge/badge-spec";
import { encodePng } from "@canbadge/fixtures";
import { PDFDict, PDFDocument, PDFName, PDFRawStream } from "pdf-lib";
import { FRAME_INSETS_MM, renderCalibrationPdf } from "./calibration-pdf";
import { contentOf, imageDraws } from "./pdf-test-utils";
import { coverRect, renderSheetPdf } from "./sheet-pdf";

// PDF の中身（命令）を読んで、実寸・切り取り・画像・注文番号を確かめる。見た目の確認は、PDF を画像にして、目で行う。

let dataDir: string;
beforeAll(() => {
  dataDir = mkdtempSync(join(tmpdir(), "canbadge-pdf-"));
  mkdirSync(join(dataDir, "images"), { recursive: true });
  writeFileSync(join(dataDir, "images", "a.png"), encodePng(16, 16, new Uint8Array(16 * 16 * 3)));
  writeFileSync(
    join(dataDir, "images", "wide.png"),
    encodePng(40, 20, new Uint8Array(40 * 20 * 3)),
  );
  writeFileSync(join(dataDir, "images", "note.txt"), "これは画像ではありません");
});
afterAll(() => rmSync(dataDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }));

async function imageCount(bytes: Uint8Array): Promise<number> {
  const doc = await PDFDocument.load(bytes);
  let count = 0;
  for (const [, object] of doc.context.enumerateIndirectObjects()) {
    if (object instanceof PDFRawStream || object instanceof PDFDict) {
      const dict = object instanceof PDFRawStream ? object.dict : object;
      if (dict.get(PDFName.of("Subtype")) === PDFName.of("Image")) count++;
    }
  }
  return count;
}

const hex = (text: string) => Buffer.from(text, "latin1").toString("hex").toUpperCase();
const sheet = (
  badges: { imagePath: string; orderNumberText: string; kira?: boolean }[],
  spec = badgeSpec,
) =>
  renderSheetPdf(spec, badges, {
    dataDir,
    sheetLabel: "SHEET TEST",
    printedAtText: "2026-11-03 20:40",
  });
const six = ["001", "002", "003", "004", "005", "006"].map((orderNumberText) => ({
  imagePath: "images/a.png",
  orderNumberText,
}));

describe("印刷シートの PDF", () => {
  test("A4（210 × 297mm）の 1 ページ", async () => {
    const doc = await PDFDocument.load(await sheet(six));
    expect(doc.getPageCount()).toBe(1);
    const { width, height } = doc.getPage(0).getSize();
    expect(width).toBeCloseTo(mmToPt(210), 3);
    expect(height).toBeCloseTo(mmToPt(297), 3);
  });

  test("バッジの画像は、画素数に関係なく、実寸（印刷円 70mm）で置かれる", async () => {
    const content = await contentOf(await sheet(six));
    const draws = imageDraws(content);
    expect(draws).toHaveLength(6);
    for (const draw of draws) {
      expect(draw.widthPt).toBeCloseTo(mmToPt(printDiameterMm(badgeSpec)), 6);
      expect(draw.heightPt).toBeCloseTo(mmToPt(printDiameterMm(badgeSpec)), 6);
    }
    expect(draws[0]?.widthPt).toBeCloseTo(198.43, 2);
  });

  test("画像は、印刷する円の中だけに切り取られる（6 個とも）", async () => {
    const content = await contentOf(await sheet(six));
    // 円の経路を閉じて（h）、切り取り（W）、経路を捨てる（n）。6 個分
    expect(content.split("\nh\nW\nn\n").length - 1).toBe(6);
  });

  test("注文番号が、バッジの数だけ、印字される（フォントの文字コードで確かめる）", async () => {
    const content = await contentOf(await sheet(six));
    for (const text of ["001", "002", "003", "004", "005", "006"]) {
      expect(content.toUpperCase()).toContain(`<${hex(text)}>`);
    }
  });

  test("キラフィルムのバッジだけ、注文番号の横に KIRA と印字される", async () => {
    const content = (
      await contentOf(
        await sheet([
          { imagePath: "images/a.png", orderNumberText: "007", kira: true },
          { imagePath: "images/a.png", orderNumberText: "008" },
        ]),
      )
    ).toUpperCase();
    expect(content).toContain(`<${hex("007 KIRA")}>`);
    expect(content).toContain(`<${hex("008")}>`);
    expect(content).not.toContain(`<${hex("008 KIRA")}>`);
  });

  test("シートの名前と印刷日時が、用紙の上に印字される", async () => {
    const content = (await contentOf(await sheet(six))).toUpperCase();
    expect(content).toContain(hex("SHEET TEST  2026-11-03 20:40"));
  });

  test("数が少ないシート：その数だけ置く（1 個でも、0 個でも壊れない）", async () => {
    const one = await contentOf(await sheet(six.slice(0, 1)));
    expect(imageDraws(one)).toHaveLength(1);
    const none = await PDFDocument.load(await sheet([]));
    expect(none.getPageCount()).toBe(1);
  });

  test("載せられる数（6 個）を超えたら、断る", async () => {
    await expect(
      sheet([...six, { imagePath: "images/a.png", orderNumberText: "007" }]),
    ).rejects.toThrow("6 個まで");
  });

  test("同じ画像が何度載っても、PDF には 1 回だけ埋め込む（再印刷で、同じ画像が並ぶとき）", async () => {
    expect(await imageCount(await sheet(six))).toBe(1);
    const two = [...six.slice(0, 3), { imagePath: "images/wide.png", orderNumberText: "010" }];
    expect(await imageCount(await sheet(two))).toBe(2);
  });

  test("較正：補正なしなら、変換を掛けない。倍率とずらしがあれば、全体に掛かる", async () => {
    // 実機で測った較正（badgeSpec の既定）ではなく、補正なしの設定で、確かめる
    const identity = { scaleX: 1, scaleY: 1, offsetXMm: 0, offsetYMm: 0 };
    const plain = await contentOf(await sheet(six, { ...badgeSpec, calibration: identity }));
    expect(plain).not.toMatch(/1\.02 0 0 1\.01/);
    // 補正なし：全体を包む「1 0 0 1 0 0 cm」も入れない
    expect(plain.startsWith("q\n1 0 0 1 0 0 cm")).toBe(false);
    // 実機で測った較正が、既定として、実際に掛かっている（縦だけ 0.997）
    const measured = await contentOf(await sheet(six));
    expect(measured).toMatch(/1 0 0 0\.997 /);
    const adjusted: BadgeSpec = {
      ...badgeSpec,
      calibration: { scaleX: 1.02, scaleY: 1.01, offsetXMm: 1, offsetYMm: -0.5 },
    };
    const content = await contentOf(await sheet(six, adjusted));
    expect(content).toMatch(/1\.02 0 0 1\.01 /);
    // 画像の実寸（印刷円）の命令そのものは、補正の倍率の内側で、変わらない
    expect(imageDraws(content)).toHaveLength(6);
  });

  test("画像が見つからない・形式が違う・データ置き場の外を指すときは、分かる文で断る", async () => {
    await expect(sheet([{ imagePath: "images/none.png", orderNumberText: "001" }])).rejects.toThrow(
      "画像が見つかりません",
    );
    await expect(sheet([{ imagePath: "images/note.txt", orderNumberText: "001" }])).rejects.toThrow(
      "PNG・JPEG ではありません",
    );
    await expect(sheet([{ imagePath: "../outside.png", orderNumberText: "001" }])).rejects.toThrow(
      "データ置き場の外",
    );
    await expect(sheet([{ imagePath: "/etc/passwd", orderNumberText: "001" }])).rejects.toThrow();
  });

  test("面付けの寸法は、設定に追従する（直径を変えると、PDF の画像の寸法も変わる）", async () => {
    const small: BadgeSpec = { ...badgeSpec, diameterMm: 40, bleedMm: 5 };
    const content = await contentOf(await sheet(six, small));
    expect(imageDraws(content)[0]?.widthPt).toBeCloseTo(mmToPt(50), 6);
  });
});

describe("画像のはめ込み", () => {
  test("正方形の画像は、そのまま円の大きさに合わせる", () => {
    expect(coverRect(827, 827, 70)).toEqual({ widthMm: 70, heightMm: 70 });
  });

  test("横長の画像は、高さを円に合わせて、横がはみ出す（円で切り取られる）", () => {
    const size = coverRect(40, 20, 70);
    expect(size.heightMm).toBeCloseTo(70, 9);
    expect(size.widthMm).toBeCloseTo(140, 9);
  });

  test("縦長の画像は、幅を円に合わせて、縦がはみ出す", () => {
    const size = coverRect(20, 40, 70);
    expect(size.widthMm).toBeCloseTo(70, 9);
    expect(size.heightMm).toBeCloseTo(140, 9);
  });
});

describe("較正用ページ", () => {
  test("A4 の 1 ページ。印刷円と表の円の大きさを書く", async () => {
    const bytes = await renderCalibrationPdf(badgeSpec);
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(1);
    expect(doc.getPage(0).getSize().width).toBeCloseTo(mmToPt(210), 3);
    const content = (await contentOf(bytes)).toUpperCase();
    expect(content).toContain(hex("70 mm (print) / 58 mm (face)"));
  });

  test("入れ子の枠（縁から 1〜10mm）が、すべて描かれる", async () => {
    const content = await contentOf(await renderCalibrationPdf(badgeSpec));
    // 枠の 1 辺 = 1 本の線（l）。8 つの枠 × 4 辺
    const lines = [...content.matchAll(/ l\b/g)].length;
    expect(lines).toBeGreaterThanOrEqual(FRAME_INSETS_MM.length * 4);
  });

  test("補正なし（測定用）と補正あり（確認用）で、中身が違う。補正なしは、設定の較正に影響されない", async () => {
    const calibrated: BadgeSpec = {
      ...badgeSpec,
      calibration: { scaleX: 1.02, scaleY: 1.01, offsetXMm: 1, offsetYMm: 1 },
    };
    const measure = await contentOf(await renderCalibrationPdf(calibrated));
    const nominal = await contentOf(await renderCalibrationPdf(badgeSpec));
    expect(measure).toBe(nominal);
    const applied = await contentOf(
      await renderCalibrationPdf(calibrated, { applyCalibration: true }),
    );
    expect(applied).not.toBe(nominal);
    expect(applied).toMatch(/1\.02 0 0 1\.01 /);
  });
});
