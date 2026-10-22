import { Checkbox, TextField } from "@canbadge/ui";
import {
  ALLOW_OTHERS_LABEL,
  DISPLAY_NAME_MAX,
  type PostFormState,
  SELF_MADE_LABEL,
} from "./archive-post-logic";

/**
 * 投稿の入力（表示名・同意 2 項目）。「投稿だけ」の画面と、注文の確認画面（注文と同時に投稿）で、同じものを使う。
 * 同意のチェックがないと投稿できないことは、呼び出し側が、canPost でボタンを押せなくして保証する（api でも断る）
 */
export function ArchivePostFields({
  value,
  onChange,
  disabled = false,
}: {
  value: PostFormState;
  onChange: (next: PostFormState) => void;
  disabled?: boolean;
}) {
  return (
    <fieldset className="cb-post" disabled={disabled}>
      <legend className="cb-post__legend">みんなの作品として公開する</legend>
      <p className="cb-muted">
        公開すると、他のお客さんが、あなたの作品を見て、同じバッジを注文できます。公開されるのは、スタッフが確認したあとです。投稿した、この端末から、いつでも取り下げられます。
      </p>
      <TextField
        label="表示名（ニックネーム）"
        hint={`${DISPLAY_NAME_MAX} 文字まで。本名や連絡先は、書かないでください`}
        value={value.displayName}
        maxLength={DISPLAY_NAME_MAX}
        autoComplete="off"
        onChange={(event) => onChange({ ...value, displayName: event.target.value })}
      />
      <Checkbox
        label={SELF_MADE_LABEL}
        checked={value.selfMade}
        onChange={(event) => onChange({ ...value, selfMade: event.target.checked })}
      />
      <Checkbox
        label={ALLOW_OTHERS_LABEL}
        checked={value.allowOthersToOrder}
        onChange={(event) => onChange({ ...value, allowOthersToOrder: event.target.checked })}
      />
    </fieldset>
  );
}
