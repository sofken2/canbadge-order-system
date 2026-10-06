import { Button } from "@canbadge/ui";
import { DEFAULT_STRENGTH, FILTER_CHOICES } from "./filter-params";
import { EDITOR_FONTS } from "./fonts";
import { PEN_MAX_MM, PEN_MIN_MM } from "./layers";
import { type Filter, MAX_TEXT_LENGTH, type StickerLayer, type TextLayer } from "./model";
import { PALETTE } from "./palette";
import { STICKER_VIEWBOX, STICKERS } from "./stickers";

// 道具のパネル（文字・スタンプ・背景・フィルター）。状態は、BadgeEditor が持ち、ここは表示と入力だけ。

/** 色の選択。パレットの色と、ほかの色（色の入力）。色は、来場者のデザインの色なので、画面のトークンとは別 */
export function Swatches({
  label,
  value,
  onPick,
}: {
  label: string;
  value: string;
  onPick: (color: string) => void;
}) {
  const inPalette = PALETTE.some((item) => item.color.toLowerCase() === value.toLowerCase());
  return (
    <fieldset className="cb-editor__swatches">
      <legend className="cb-field__label">{label}</legend>
      <div className="cb-editor__swatch-row">
        {PALETTE.map((item) => (
          <button
            key={item.color}
            type="button"
            className="cb-editor__swatch"
            aria-label={item.label}
            aria-pressed={value.toLowerCase() === item.color.toLowerCase()}
            style={{ backgroundColor: item.color }}
            onClick={() => onPick(item.color)}
          />
        ))}
        <label
          className={`cb-editor__swatch cb-editor__swatch--custom${inPalette ? "" : " is-active"}`}
        >
          <span className="cb-editor__visually-hidden">ほかの色</span>
          <input type="color" value={value} onChange={(event) => onPick(event.target.value)} />
        </label>
      </div>
    </fieldset>
  );
}

export type TextDraft = { text: string; fontId: string; color: string };

export function TextPanel({
  selected,
  draft,
  onDraft,
  onChangeSelected,
  onAdd,
}: {
  /** 選んでいる文字。あれば、その文字を直す。なければ、これから足す文字（draft）を決める */
  selected: TextLayer | undefined;
  draft: TextDraft;
  onDraft: (patch: Partial<TextDraft>) => void;
  onChangeSelected: (patch: Partial<Pick<TextLayer, "text" | "fontId" | "color">>) => void;
  onAdd: () => void;
}) {
  const current = selected ?? draft;
  const change = (patch: Partial<TextDraft>) =>
    selected ? onChangeSelected(patch) : onDraft(patch);
  return (
    <div className="cb-editor__panel">
      <label className="cb-field">
        <span className="cb-field__label">
          {selected ? "選んだ文字を直す" : "入れる文字"}（{MAX_TEXT_LENGTH} 文字まで）
        </span>
        <input
          className="cb-input"
          value={current.text}
          maxLength={MAX_TEXT_LENGTH}
          onChange={(event) => change({ text: event.target.value })}
        />
      </label>
      <fieldset className="cb-editor__fonts">
        <legend className="cb-field__label">書体</legend>
        <div className="cb-editor__font-row">
          {EDITOR_FONTS.map((font) => (
            <button
              key={font.id}
              type="button"
              className="cb-editor__font"
              aria-pressed={current.fontId === font.id}
              // 見本は、その書体で見せる（ボタンの文字が、書体の見え方になる）
              style={{ fontFamily: `"${font.family}", sans-serif`, fontWeight: font.weight }}
              onClick={() => change({ fontId: font.id })}
            >
              {font.label}
            </button>
          ))}
        </div>
      </fieldset>
      <Swatches label="文字の色" value={current.color} onPick={(color) => change({ color })} />
      {!selected && (
        <Button variant="line" onClick={onAdd} disabled={draft.text.trim() === ""}>
          文字を入れる
        </Button>
      )}
    </div>
  );
}

export function StickerPanel({
  selected,
  color,
  onColor,
  onAdd,
}: {
  selected: StickerLayer | undefined;
  /** これから足すスタンプの色 */
  color: string;
  onColor: (color: string) => void;
  onAdd: (stickerId: string) => void;
}) {
  const current = selected?.color ?? color;
  return (
    <div className="cb-editor__panel">
      <fieldset className="cb-editor__stickers">
        <legend className="cb-editor__visually-hidden">スタンプ</legend>
        {STICKERS.map((sticker) => (
          <button
            key={sticker.id}
            type="button"
            className="cb-editor__sticker"
            aria-label={`${sticker.label}を入れる`}
            onClick={() => onAdd(sticker.id)}
          >
            <svg viewBox={`0 0 ${STICKER_VIEWBOX} ${STICKER_VIEWBOX}`} aria-hidden="true">
              {sticker.parts.map((part) => (
                <path key={part.d} d={part.d} fill={part.color ?? current} />
              ))}
            </svg>
          </button>
        ))}
      </fieldset>
      <Swatches
        label={selected ? "選んだスタンプの色" : "スタンプの色"}
        value={current}
        onPick={onColor}
      />
    </div>
  );
}

export function BackgroundPanel({
  color,
  onColor,
}: {
  color: string;
  onColor: (color: string) => void;
}) {
  return (
    <div className="cb-editor__panel">
      <Swatches label="背景の色" value={color} onPick={onColor} />
      <p className="cb-muted">写真が覆っていない部分と、透明な部分の色になります。</p>
    </div>
  );
}

export function FilterPanel({
  filter,
  disabled,
  onType,
  onStrength,
}: {
  filter: Filter | undefined;
  disabled: boolean;
  onType: (type: Filter["type"]) => void;
  onStrength: (strength: number) => void;
}) {
  const type = filter?.type ?? "none";
  const choice = FILTER_CHOICES.find((item) => item.type === type);
  return (
    <div className="cb-editor__panel">
      <fieldset className="cb-editor__filters">
        <legend className="cb-editor__visually-hidden">フィルター</legend>
        {FILTER_CHOICES.map((item) => (
          <button
            key={item.type}
            type="button"
            className="cb-editor__font"
            aria-pressed={type === item.type}
            disabled={disabled}
            onClick={() => onType(item.type)}
          >
            {item.label}
          </button>
        ))}
      </fieldset>
      {choice?.usesStrength && (
        <label className="cb-field">
          <span className="cb-field__label">強さ</span>
          <input
            type="range"
            className="cb-editor__range"
            min={0}
            max={1}
            step={0.05}
            value={filter?.strength ?? DEFAULT_STRENGTH}
            onChange={(event) => onStrength(Number(event.target.value))}
          />
        </label>
      )}
      {disabled && <p className="cb-muted">先に、写真を選んでください。</p>}
    </div>
  );
}

export function PenPanel({
  color,
  onColor,
  widthMm,
  onWidth,
  canUndo,
  canRedo,
  hasStrokes,
  onUndo,
  onRedo,
  onClear,
}: {
  color: string;
  onColor: (color: string) => void;
  widthMm: number;
  onWidth: (widthMm: number) => void;
  canUndo: boolean;
  canRedo: boolean;
  hasStrokes: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onClear: () => void;
}) {
  return (
    <div className="cb-editor__panel">
      <p className="cb-muted">
        絵の上を、指でなぞると描けます。ほかの道具に切り替えると、写真や飾りを動かす操作に戻ります。
      </p>
      <Swatches label="ペンの色" value={color} onPick={onColor} />
      <label className="cb-field">
        <span className="cb-field__label">太さ {widthMm.toFixed(1)} mm</span>
        <input
          type="range"
          className="cb-editor__range"
          min={PEN_MIN_MM}
          max={PEN_MAX_MM}
          step={0.5}
          value={widthMm}
          onChange={(event) => onWidth(Number(event.target.value))}
        />
      </label>
      <div className="cb-editor__pen-actions">
        <Button variant="line" onClick={onUndo} disabled={!canUndo}>
          ひとつ戻す
        </Button>
        <Button variant="line" onClick={onRedo} disabled={!canRedo}>
          やり直す
        </Button>
        <Button variant="line" onClick={onClear} disabled={!hasStrokes}>
          描いたものを全部消す
        </Button>
      </div>
    </div>
  );
}
