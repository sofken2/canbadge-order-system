import { Button } from "@canbadge/ui";
import { useId, useRef } from "react";
import { DEFAULT_STRENGTH, FILTER_CHOICES } from "./filter-params";
import { EDITOR_FONTS } from "./fonts";
import {
  PEN_MAX_MM,
  PEN_MIN_MM,
  TEXT_OUTLINE_MAX,
  TEXT_OUTLINE_MIN,
  TEXT_OUTLINE_RATIO,
} from "./layers";
import {
  type ColorAdjust,
  type Filter,
  MAX_TEXT_LENGTH,
  type StickerLayer,
  type TextLayer,
} from "./model";
import { PALETTE } from "./palette";
import { STICKER_VIEWBOX, STICKERS } from "./stickers";

// 道具のパネル（文字・スタンプ・背景・フィルター）。状態は、BadgeEditor が持ち、ここは表示と入力だけ。

/**
 * 色の選択。パレットの色と、ほかの色（色の入力）。色は、来場者のデザインの色なので、画面のトークンとは別。
 * allowNone のときは、先頭に「なし」を置く（選ぶと、空文字で知らせる）
 */
export function Swatches({
  label,
  value,
  onPick,
  allowNone = false,
}: {
  label: string;
  value: string;
  onPick: (color: string) => void;
  allowNone?: boolean;
}) {
  const none = value === "";
  const inPalette =
    none || PALETTE.some((item) => item.color.toLowerCase() === value.toLowerCase());
  return (
    <fieldset className="cb-editor__swatches">
      <legend className="cb-field__label">{label}</legend>
      <div className="cb-editor__swatch-row">
        {allowNone && (
          <button
            type="button"
            className="cb-editor__swatch cb-editor__swatch--none"
            aria-label="なし"
            title="なし"
            aria-pressed={none}
            onClick={() => onPick("")}
          />
        )}
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
          <input
            type="color"
            value={none ? "#000000" : value}
            onChange={(event) => onPick(event.target.value)}
          />
        </label>
      </div>
    </fieldset>
  );
}

/** これから入れる文字の設定。outlineColor は、ふちの色（空文字は、ふちなし）。outlineWidth は、ふちの太さ（文字の大きさに対する割合） */
export type TextDraft = {
  text: string;
  fontId: string;
  color: string;
  outlineColor: string;
  outlineWidth: number;
};

export function TextPanel({
  selected,
  draft,
  onDraft,
  onChangeSelected,
  onAdd,
  onNew,
  hasText,
}: {
  /** 選んでいる文字。あれば、その文字を直す。なければ、これから足す文字（draft）を決める */
  selected: TextLayer | undefined;
  draft: TextDraft;
  onDraft: (patch: Partial<TextDraft>) => void;
  onChangeSelected: (patch: Partial<TextDraft>) => void;
  /** 文字を選んでいないときに打ち始めたら、その文字で新しく入れる */
  onAdd: (text: string) => void;
  /** 「＋ 文字を追加」。選んでいる文字を外して、次に打つ文字を新しく入れられるようにする */
  onNew: () => void;
  /** キャンバスに文字が 1 つでもあるか。なければ、欄に打てば入るので「＋ 文字を追加」は出さない */
  hasText: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const inputId = useId();
  const current = selected ?? draft;
  const change = (patch: Partial<TextDraft>) => {
    if (selected) return onChangeSelected(patch);
    // 打ち始めた時点でキャンバスに入れ、選んだ状態にする。続けて打つと、その文字を直していく
    if (patch.text !== undefined && patch.text.trim() !== "") return onAdd(patch.text);
    onDraft(patch);
  };
  return (
    <div className="cb-editor__panel">
      <div className="cb-field">
        <label className="cb-field__label" htmlFor={inputId}>
          {selected ? "選んだ文字を直す" : "入れる文字"}（{MAX_TEXT_LENGTH} 文字まで）
        </label>
        <div className="cb-editor__text-row">
          <input
            id={inputId}
            ref={inputRef}
            className="cb-input"
            value={current.text}
            maxLength={MAX_TEXT_LENGTH}
            onChange={(event) => change({ text: event.target.value })}
          />
          {/*
           * 文字はいくつでも入れられる。欄の右に置き、押すと選択が外れて欄が空になり、そのまま次の文字を打てる。
           * 文字がまだないときは、欄に打てば入るので出さない
           */}
          {hasText && (
            <Button
              variant="line"
              className="cb-editor__add"
              onClick={() => {
                onNew();
                inputRef.current?.focus();
              }}
            >
              ＋ 文字を追加
            </Button>
          )}
        </div>
      </div>
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
      <Swatches
        label="ふちの色"
        value={current.outlineColor ?? ""}
        onPick={(outlineColor) => change({ outlineColor })}
        allowNone
      />
      {/* ふちの太さ。ふちがあるときだけ（なしのときは、太さは関係ない） */}
      {current.outlineColor && (
        <label className="cb-field">
          <span className="cb-field__label">ふちの太さ</span>
          <input
            type="range"
            className="cb-editor__range"
            min={TEXT_OUTLINE_MIN}
            max={TEXT_OUTLINE_MAX}
            step={0.01}
            value={current.outlineWidth ?? TEXT_OUTLINE_RATIO}
            onChange={(event) => change({ outlineWidth: Number(event.target.value) })}
          />
        </label>
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
        {/* 押すたびに 1 つ増える。いくつでも入れられる */}
        <legend className="cb-field__label">スタンプを追加</legend>
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
    </div>
  );
}

export function FilterPanel({
  filter,
  adjust,
  disabled,
  onType,
  onStrength,
  onAdjust,
}: {
  filter: Filter | undefined;
  adjust: ColorAdjust | undefined;
  disabled: boolean;
  onType: (type: Filter["type"]) => void;
  onStrength: (strength: number) => void;
  onAdjust: (change: Partial<ColorAdjust>) => void;
}) {
  const type = filter?.type ?? "none";
  const choice = FILTER_CHOICES.find((item) => item.type === type);
  return (
    <div className="cb-editor__panel">
      <fieldset className="cb-editor__filters">
        <legend className="cb-editor__visually-hidden">効果</legend>
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
      <div className="cb-editor__adjust">
        <AdjustSlider
          label="肌をきれいに"
          note="赤みのある部分のくすみ（シアン）を抜く"
          value={adjust?.skin ?? 0}
          disabled={disabled}
          onChange={(skin) => onAdjust({ skin })}
        />
        <AdjustSlider
          label="あざやかに"
          note="色みを強くする。印刷は画面よりくすむので、少し上げると近くなる"
          value={adjust?.saturation ?? 0}
          disabled={disabled}
          onChange={(saturation) => onAdjust({ saturation })}
        />
      </div>
      {disabled && <p className="cb-muted">先に画像を選んでください。</p>}
    </div>
  );
}

/** 色の補正のスライダー。0 は補正なし。今の強さを % で出す */
function AdjustSlider({
  label,
  note,
  value,
  disabled,
  onChange,
}: {
  label: string;
  note: string;
  value: number;
  disabled: boolean;
  onChange: (value: number) => void;
}) {
  return (
    <label className="cb-field cb-editor__adjust-row">
      <span className="cb-field__label cb-editor__adjust-head">
        <span>{label}</span>
        <output className="cb-editor__adjust-value">{Math.round(value * 100)}%</output>
      </span>
      <input
        type="range"
        className="cb-editor__range"
        min={0}
        max={1}
        step={0.05}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(Number(event.target.value))}
      />
      <span className="cb-muted cb-editor__adjust-note">{note}</span>
    </label>
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
          元に戻す
        </Button>
        <Button variant="line" onClick={onRedo} disabled={!canRedo}>
          やり直す
        </Button>
        {/* 描いたものを全部消す。ほかの道具と同じ、アイコンだけの丸いボタン（名前は、説明と読み上げで） */}
        <button
          type="button"
          className="cb-editor__icon"
          aria-label="描いたものを全部消す"
          title="描いたものを全部消す"
          onClick={onClear}
          disabled={!hasStrokes}
        >
          <svg
            viewBox="0 0 24 24"
            width="18"
            height="18"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3" />
          </svg>
        </button>
      </div>
    </div>
  );
}
