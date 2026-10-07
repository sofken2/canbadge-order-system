# Discord のアイコンの取り込み（W08）の設定

エディタの「Discord のアイコンを使う」ボタンを、使えるようにする手順。**使わないなら、何もしなくてよい**（ボタンが出ないだけで、ほかの機能に影響はない）。

## 仕組み（来場者の流れ）

1. 注文画面の「Discord のアイコンを使う」を押す → Discord の許可画面
2. 来場者が「許可」する（権限は、**自分のアイコンを読むだけ**の `identify`）
3. 注文画面に戻り、アイコンがエディタに読み込まれている

**保存するもの：アイコンの画像だけ**（持ち込みの画像と同じ場所・同じ扱い。注文に使われなければ 15 分で消える）。Discord のユーザー ID・名前・アクセストークンは、**保存しない**（画像を取ったら、トークンを Discord 側で失効させて、捨てる）。ログにも出さない。

権利の確認は、注文の確認画面の「自作の画像、または使ってよい画像です」への同意が、Discord のアイコンにも掛かる（spec.md 11.4）。

## 手順

### 1. Discord にアプリを登録する（管理者・5 分）

1. <https://discord.com/developers/applications> を開き、Discord のアカウントでログインする
2. 「New Application」→ 名前（例：学祭缶バッジ）→ 利用規約に同意 → Create
3. 左の「**OAuth2**」を開く
   - **Client ID** を控える（公開してよい）
   - **Client Secret** の「Reset Secret」→ 表示された値を控える（**秘密。再表示できない。人に見せない・コミットしない**）
   - 「**Redirects**」に、戻り先の URL を、**すべて**追加して、保存する：
     - 本番：`https://badge.sofken2-ts.app/api/discord/callback`
     - 開発（この PC で試す）：`http://localhost:3000/api/discord/callback`
   - **URL は、`.env` の `DISCORD_REDIRECT_URI` と、1 文字も違わないこと**（末尾の `/` も）。違うと、Discord が、`Invalid OAuth2 redirect_uri` で断る
4. 「Bot」や権限（Scopes のうち `identify` 以外）は、**設定しない**

### 2. `.env` に書く（処理 PC）

```
DISCORD_CLIENT_ID=<Client ID>
DISCORD_CLIENT_SECRET=<Client Secret>
DISCORD_REDIRECT_URI=https://badge.sofken2-ts.app/api/discord/callback
VITE_DISCORD_ENABLED=1
```

- 3 つの `DISCORD_*` が、**そろっているときだけ**、api が受け付ける（1 つでも欠けると、押しても「使えません」と表示される）
- `VITE_DISCORD_ENABLED=1` は、ボタンを出すためのもの。**ビルド時に決まる**ので、書いたあと、`bun run build` を、やり直す
- `DISCORD_CLIENT_SECRET` は、画面（ブラウザ）には、埋め込まれない（`apps/web/vite.config.ts` の `envPrefix` に、`DISCORD_` を足さない）

### 3. 反映する

api と web を、再起動する（`infra/windows` の起動スクリプト）。起動のログに、Discord に関する警告が出ていないことを確かめる。

## 確認（本番の前に、実機で）

| 確認 | 期待する結果 | 結果 |
| --- | --- | --- |
| スマホで注文画面を開く | 「Discord のアイコンを使う」が出る | |
| 押す | Discord の許可画面が出る（アプリ名・「ユーザー情報の確認」だけを求めている） | |
| 許可する | 注文画面に戻り、アイコンがエディタに載る。アドレスに `?imageId=` が残らない | |
| 許可画面で「キャンセル」 | 注文画面に戻り、「キャンセルされました」と出る。手元の画像を選べる | |
| アイコンを設定していない Discord のアカウントで試す | 「アイコンが設定されていません」と出る | |
| 動くアイコン（GIF）のアカウントで試す | 静止画として載る | |
| 許可画面を開いたまま、10 分以上待ってから許可する | 「確認できませんでした」と出る（やり直せる） | |
| 学内の Wi-Fi・モバイル回線の、両方で | どちらでも、同じように動く | |
| Discord の「連携済みのアプリ」（設定 → 連携サービス・認証済みアプリ） | 許可したあと、アプリが残らない、または、残っても問題ない（トークンは失効済み） | |

## 困ったとき

| 症状 | 原因と対処 |
| --- | --- |
| ボタンが出ない | `VITE_DISCORD_ENABLED=1` が、ビルドに入っていない。`.env` に書いて、`bun run build` をやり直す |
| 押すと「いま、Discord から取り込めません」 | `DISCORD_*` の 3 つが、そろっていない。api を、再起動していない。api のログ（`DISCORD_CLIENT_ID … が未設定です`）を見る |
| Discord の画面が `Invalid OAuth2 redirect_uri` | `DISCORD_REDIRECT_URI` と、開発者サイトの Redirects が、一致していない（`http` と `https`・末尾の `/`・ドメインの違い） |
| 許可したのに、「確認できませんでした」 | Cookie が付かなかった（ブラウザが、Cookie を止めている・別のドメインで始めた）。許可画面を開いたまま 10 分以上たった |
| 許可したのに、「取り込めません」 | Discord への通信が、処理 PC から、できていない（学内のファイアウォール）。`discord.com` と `cdn.discordapp.com` への、外向きの HTTPS が、必要 |
| 「短い間に、何度も試しています」 | 画像のアップロードと同じ回数の制限（10 分に 60 回、IP ごと） |

## 運用の注意

- Client Secret を、漏らした疑いがあれば、開発者サイトで「Reset Secret」→ `.env` を更新 → api を再起動する
- 学祭が終わったら、開発者サイトで、アプリを削除してよい
