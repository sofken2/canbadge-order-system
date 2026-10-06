import jsQR from "jsqr";
import { fitSize } from "./scan-logic";

// QR の解読。jsQR で、フレームを縮小してから解く（どの端末でも同じ動きになる）。

// 仕様書 6.3：解読は、ブラウザの標準機能に依存せず、ライブラリ（jsQR）で行う（端末による対応差を避けるため）。
// 標準の BarcodeDetector は、明示的に頼んだときだけ使う（実験用。既定では使わない）。
export type DecoderKind = "js" | "native";

export type Decoder = {
  kind: "native" | "js";
  /** カメラの映像の、いまの 1 コマから QR を探す。読めたら、その文字列 */
  decode: (video: HTMLVideoElement) => Promise<string | undefined>;
};

/** jsQR に渡す前の縮小の上限（長いほうの辺、px）。大きいと遅く、小さいと小さな QR を読めない */
const MAX_DECODE_SIDE = 640;

// TypeScript の DOM の型に、BarcodeDetector がまだないので、使う分だけ宣言する
type BarcodeDetectorLike = {
  detect: (source: CanvasImageSource) => Promise<{ rawValue: string }[]>;
};
type BarcodeDetectorConstructor = {
  new (options?: { formats?: string[] }): BarcodeDetectorLike;
  getSupportedFormats?: () => Promise<string[]>;
};

async function createNative(): Promise<Decoder | undefined> {
  const Detector = (globalThis as { BarcodeDetector?: BarcodeDetectorConstructor }).BarcodeDetector;
  if (!Detector) return undefined;
  try {
    const formats = await Detector.getSupportedFormats?.();
    if (formats && !formats.includes("qr_code")) return undefined;
    const detector = new Detector({ formats: ["qr_code"] });
    return {
      kind: "native",
      decode: async (video) => (await detector.detect(video))[0]?.rawValue || undefined,
    };
  } catch {
    return undefined;
  }
}

function createJs(): Decoder {
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d", { willReadFrequently: true });
  return {
    kind: "js",
    decode: async (video) => {
      if (!context || video.videoWidth === 0) return undefined;
      const { width, height } = fitSize(video.videoWidth, video.videoHeight, MAX_DECODE_SIDE);
      canvas.width = width;
      canvas.height = height;
      context.drawImage(video, 0, 0, width, height);
      const image = context.getImageData(0, 0, width, height);
      // 画面の QR は、白地に黒。色を反転した QR は、読まない（読もうとすると、倍の時間がかかる）
      return (
        jsQR(image.data, width, height, { inversionAttempts: "dontInvert" })?.data || undefined
      );
    },
  };
}

/** 解読の方法を決める。既定は jsQR。native を頼んでも、使えない端末では、js にする */
export async function createDecoder(kind: DecoderKind = "js"): Promise<Decoder> {
  if (kind !== "js") {
    const native = await createNative();
    if (native) return native;
  }
  return createJs();
}
