import Konva from "konva";
import { adjustImageData, hasColorAdjust } from "./color-adjust";
import { filterParams, hasFilter } from "./filter-params";
import type { ColorAdjust, Filter } from "./model";

// 写真のフィルターをかける。Konva の組み込みのフィルターを、縮小済みの写真（長辺 2048px 以下）に、1 回だけかける。
// ノードにかけると、ピンチで大きさが変わるたびに計算し直すので、重くなる。
// フィルターを変えたときだけ、かけたあとの写真を作り直す。

/**
 * Konva のフィルターは、`this` に「値を返す関数（brightness() など）」を持つノードを受け取る作り。
 * ノードを作らずに使えるよう、値を返す関数だけを持つ入れ物を渡す
 */
type KonvaFilter = (this: unknown, imageData: ImageData) => void;
const run = (filter: unknown, values: Record<string, number>, imageData: ImageData): void => {
  const accessors = Object.fromEntries(
    Object.entries(values).map(([name, value]) => [name, () => value]),
  );
  (filter as KonvaFilter).call(accessors, imageData);
};

/**
 * フィルターと色の補正をかけた写真を作る。どちらもなければ、もとの写真をそのまま返す（コピーしない）
 */
export function applyFilter(
  source: HTMLCanvasElement,
  filter: Filter | undefined,
  adjust?: ColorAdjust,
): HTMLCanvasElement {
  if (!hasFilter(filter) && !hasColorAdjust(adjust)) return source;
  const params = filterParams(filter, Math.max(source.width, source.height));

  const canvas = document.createElement("canvas");
  canvas.width = source.width;
  canvas.height = source.height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return source;
  context.drawImage(source, 0, 0);
  const imageData = context.getImageData(0, 0, canvas.width, canvas.height);

  if (params.grayscale) run(Konva.Filters.Grayscale, {}, imageData);
  if (params.sepia) run(Konva.Filters.Sepia, {}, imageData);
  if (params.brightness !== 0)
    run(Konva.Filters.Brighten, { brightness: params.brightness }, imageData);
  if (params.saturation !== 0)
    run(Konva.Filters.HSL, { hue: 0, saturation: params.saturation, luminance: 0 }, imageData);
  if (params.contrast !== 0) run(Konva.Filters.Contrast, { contrast: params.contrast }, imageData);
  if (params.blurRadius > 0) run(Konva.Filters.Blur, { blurRadius: params.blurRadius }, imageData);
  // 色の補正は、フィルターのあとにかける（白黒・セピアにしたあとの肌も補正できる）
  if (adjust && hasColorAdjust(adjust)) adjustImageData(imageData.data, adjust);

  context.putImageData(imageData, 0, 0);
  return canvas;
}
