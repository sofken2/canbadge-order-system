import { Group, Image as KonvaImage, Line, Path, Text } from "react-konva";
import { findFont } from "./fonts";
import { TEXT_OUTLINE_RATIO } from "./layers";
import type { Layer, StickerLayer, TextLayer } from "./model";
import { findSticker, STICKER_VIEWBOX } from "./stickers";
import { measureTextEm } from "./text-measure";

// キャンバスに、層を描く。位置は mm で、キャンバスの中心が原点（呼ぶ側の Group が原点を合わせる）。

function TextNode({ layer }: { layer: TextLayer }) {
  const font = findFont(layer.fontId);
  const widthMm = measureTextEm(layer.text, layer.fontId) * layer.fontSizeMm;
  return (
    <Text
      x={layer.xMm}
      y={layer.yMm}
      text={layer.text}
      fontFamily={`"${font.family}", sans-serif`}
      fontStyle={font.weight === 700 ? "bold" : "normal"}
      fontSize={layer.fontSizeMm}
      lineHeight={1}
      wrap="none"
      fill={layer.color}
      // ふち：線は文字の輪郭の内と外に半分ずつ描かれるので、倍の太さで描き、塗りを上に重ねて、外側だけを見せる
      stroke={layer.outlineColor}
      strokeWidth={
        layer.outlineColor ? layer.fontSizeMm * (layer.outlineWidth ?? TEXT_OUTLINE_RATIO) * 2 : 0
      }
      fillAfterStrokeEnabled
      lineJoin="round"
      offsetX={widthMm / 2}
      offsetY={layer.fontSizeMm / 2}
      rotation={layer.rotationDeg}
    />
  );
}

function StickerNode({ layer }: { layer: StickerLayer }) {
  const sticker = findSticker(layer.stickerId);
  if (!sticker) return null;
  const scale = layer.sizeMm / STICKER_VIEWBOX;
  return (
    <Group
      x={layer.xMm}
      y={layer.yMm}
      scaleX={scale}
      scaleY={scale}
      offsetX={STICKER_VIEWBOX / 2}
      offsetY={STICKER_VIEWBOX / 2}
      rotation={layer.rotationDeg}
    >
      {sticker.parts.map((part) => (
        <Path key={part.d} data={part.d} fill={part.color ?? layer.color} />
      ))}
    </Group>
  );
}

export type LayerNodesProps = {
  layers: readonly Layer[];
  /** フィルターをかけたあとの写真。写真の層の描画に使う */
  imageSource?: HTMLCanvasElement;
  /** 書体の読み込みが終わるたびに増える。文字の描き直しのきっかけにする */
  fontsVersion: number;
};

export function LayerNodes({ layers, imageSource, fontsVersion }: LayerNodesProps) {
  return (
    <>
      {layers.map((layer) => {
        switch (layer.type) {
          case "image": {
            if (!imageSource) return null;
            const height = layer.widthMm / layer.aspect;
            return (
              <KonvaImage
                key="image"
                image={imageSource}
                x={layer.xMm}
                y={layer.yMm}
                width={layer.widthMm}
                height={height}
                offsetX={layer.widthMm / 2}
                offsetY={height / 2}
                rotation={layer.rotationDeg}
              />
            );
          }
          case "text":
            // 書体が読み込まれたら、作り直して、新しい書体で描く
            return <TextNode key={`${layer.id}-${fontsVersion}`} layer={layer} />;
          case "sticker":
            return <StickerNode key={layer.id} layer={layer} />;
          case "stroke":
            return (
              <Line
                key={layer.id}
                points={layer.points}
                stroke={layer.color}
                strokeWidth={layer.widthMm}
                tension={0.3}
                lineCap="round"
                lineJoin="round"
              />
            );
          default:
            return null;
        }
      })}
    </>
  );
}
