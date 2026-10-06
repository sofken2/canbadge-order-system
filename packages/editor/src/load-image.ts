import { fitWithin, MAX_SOURCE_SIDE } from "./image-size";

export type LoadedImage = {
  /** 上限まで縮小した写真。Konva はこれをそのまま描く（縮小済みなので、スマホでも重くならない） */
  canvas: HTMLCanvasElement;
  width: number;
  height: number;
};

async function toBlob(source: Blob | string): Promise<Blob> {
  if (typeof source !== "string") return source;
  const response = await fetch(source);
  if (!response.ok) throw new Error(`画像を読み込めませんでした（${response.status}）`);
  return response.blob();
}

type Decoded = { source: CanvasImageSource; width: number; height: number; release: () => void };

/** 写真をデコードする。EXIF の向きを直した状態で受け取る（スマホの縦撮りが横倒しにならないように） */
async function decode(blob: Blob): Promise<Decoded> {
  try {
    const bitmap = await createImageBitmap(blob, { imageOrientation: "from-image" });
    return {
      source: bitmap,
      width: bitmap.width,
      height: bitmap.height,
      release: () => bitmap.close(),
    };
  } catch {
    // createImageBitmap を使えない、またはこの形式を扱えない端末では、img 要素で読む
    const url = URL.createObjectURL(blob);
    try {
      const image = new Image();
      image.src = url;
      await image.decode();
      return {
        source: image,
        width: image.naturalWidth,
        height: image.naturalHeight,
        release: () => URL.revokeObjectURL(url),
      };
    } catch (error) {
      URL.revokeObjectURL(url);
      throw new Error("この画像は読み込めませんでした。PNG か JPEG の画像を選んでください", {
        cause: error,
      });
    }
  }
}

/**
 * 写真（ファイル、またはその URL）を読み込み、長いほうの辺が上限に収まるまで縮小する。
 * スマホの写真は 4000px 以上あり、そのまま扱うとメモリが足りなくなるため、最初に縮小する
 */
export async function loadImage(
  source: Blob | string,
  maxSide: number = MAX_SOURCE_SIDE,
): Promise<LoadedImage> {
  const decoded = await decode(await toBlob(source));
  try {
    const { width, height } = fitWithin(decoded.width, decoded.height, maxSide);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("この端末では、画像を扱えません");
    context.imageSmoothingQuality = "high";
    context.drawImage(decoded.source, 0, 0, width, height);
    return { canvas, width, height };
  } finally {
    decoded.release();
  }
}
