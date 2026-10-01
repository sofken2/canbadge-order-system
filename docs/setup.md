# 開発環境構築と GitHub 連携

この手順書は2部構成。**第1部は管理者が最初に1回だけ行う作業**（空のリモートリポジトリに最初のファイルを入れるまで）、**第2部以降は参加者全員が行う作業**。

管理者も、まず第2部の「2-1〜2-3」（ツールのインストール・GitHub へのログイン・Git の初期設定）を済ませてから第1部に進むこと。

リポジトリ: https://github.com/sofken2/canbadge-order-system

---

## 第1部：空のリポジトリに初期ファイルを入れる（管理者のみ・1回だけ）

### 1-1. 空のリポジトリをクローンする

```sh
gh repo clone sofken2/canbadge-order-system
cd canbadge-order-system
```

`You appear to have cloned an empty repository.` と表示されるが、空のリポジトリなので正常。

### 1-2. 初期ファイルを配置する

配布された初期ファイル一式の zip を、クローンしたフォルダの直下に展開する。展開後、フォルダ直下に `CLAUDE.md` と `docs/` があれば正しい位置（1段深いフォルダができた場合は、中身を1つ上に移す）。zip には次のファイルが入っている。

| パス | 内容 |
| --- | --- |
| `.gitattributes` | 改行コードの統一（内容は下記） |
| `.gitignore` | コミット対象外のファイル（内容は下記） |
| `README.md` | 1行程度の概要と「環境構築は `docs/setup.md` を参照」 |
| `CLAUDE.md` | Claude Code 用のプロジェクトルール（配布済みのファイル） |
| `docs/setup.md` | この手順書 |
| `docs/spec.md` | 仕様書 |
| `docs/tasks.md` | 初期タスク一覧とタスク解説 |
| `packages/shared/CLAUDE.md`、`packages/db/CLAUDE.md`、`apps/print-worker/CLAUDE.md` | パッケージ別の Claude Code 用ルール |

**`.gitattributes`**（本番が Windows でも、各自の git 設定に左右されず改行コードを LF に揃えるため）

```gitattributes
* text=auto eol=lf
*.bat text eol=crlf
*.cmd text eol=crlf
*.ps1 text eol=crlf
*.png binary
*.jpg binary
*.pdf binary
```

**`.gitignore`**

```gitignore
node_modules/
.turbo/
.next/
dist/
coverage/

# 環境変数（.env.example はコミットする）
.env
.env.*
!.env.example

# ローカルのデータ（DB・画像・生成PDF）
data/

# Claude Code の個人用メモ
CLAUDE.local.md

# OS
.DS_Store
Thumbs.db
```

### 1-3. 最初のコミットを push する

```sh
git add .
git commit -m "chore: 初期ファイルを追加"
git branch -M main
git push -u origin main
```

`git branch -M main` は、手元の既定ブランチ名が `master` になっている環境でも `main` に揃えるためのもの。push 後、GitHub の画面でファイルが表示されていれば完了。

**この最初の push だけは main に直接行う。** 以降の変更（T01 のモノレポ初期化を含む）はすべてブランチを切って PR で行う。

### 1-4. リポジトリの設定

main ブランチができたので、GitHub の Settings で次を設定する。

- **公開範囲とブランチ保護**：GitHub の無料プランでは、private リポジトリにブランチ保護ルールを設定できない。次のどちらかを選ぶ
  - public にして、`main` に「PR 必須」「CI の成功必須」のブランチ保護を設定する（秘密情報をコミットしないルールを徹底すれば問題ない）
  - private のまま、「main に直接 push しない」を運用ルールで守る
- **マージ方式**：Settings → General で「Squash merging」のみ許可し、マージ後にブランチを自動削除する設定を有効にする
- **ラベル**：領域（`web` `staff` `api` `print` `infra` `shared`）、難易度（`初級` `中級` `上級`）、`good first issue`、`実機`、`優先度低` を作成する
- **Projects**：ボードを作成し、列を「未着手 / 作業中 / レビュー待ち / 完了」にする
- **Issue**：`docs/tasks.md` の各タスクを1件ずつ Issue にする。タイトルは `[W01] エディタ本体` のように ID を先頭に付け、アーカイブ一式と回線断時の LAN 運用には `優先度低` ラベルを付ける

CI のブランチ保護は、T02（CI 構築）が main に入って CI のチェック名が決まってから設定する。

### 1-5. 参加者を招待する

- 個人アカウントのリポジトリの場合：Settings → Collaborators から招待する
- Organization のリポジトリの場合：Organization に招待し、リポジトリに書き込み権限（Write）を付与する

招待された人は、届いたメールか GitHub の通知から招待を承認してから、第2部の手順に進む。

---

## 第2部：各自の初期設定

### 2-1. 必要なツールをインストールする

| ツール | 用途 | Windows | macOS |
| --- | --- | --- | --- |
| Git | バージョン管理 | Git for Windows | Xcode Command Line Tools か Homebrew |
| Bun | ランタイム・パッケージ管理 | `powershell -c "irm bun.sh/install.ps1 \| iex"` | `curl -fsSL https://bun.sh/install \| bash` |
| GitHub CLI（gh） | GitHub へのログイン、Issue・PR 操作 | `winget install GitHub.cli` | `brew install gh` |
| エディタ | 開発 | VS Code 推奨 | 同左 |

インストール後、ターミナルを開き直してから確認する。

```sh
git --version
bun --version
gh --version
```

### 2-2. GitHub にログインする

```sh
gh auth login
```

対話形式で「GitHub.com」「HTTPS」を選び、ブラウザで認証する。途中で Git の認証にも使うか聞かれたら「Yes」を選ぶ。これで `git push` のたびにパスワードを聞かれなくなる。確認は `gh auth status`。

### 2-3. Git の初期設定

```sh
git config --global user.name "GitHub のユーザー名"
git config --global user.email "GitHub に登録したメールアドレス"
git config --global init.defaultBranch main
git config --global pull.rebase true
```

メールアドレスを公開したくない場合は、GitHub の Settings → Emails に表示される `...@users.noreply.github.com` のアドレスを使う。

### 2-4. リポジトリを取得して起動する

**管理者が第1部の 1-3（最初の push）を終えてから行う。** それより前に空の状態でクローンしていた場合は、そのフォルダを削除してからクローンし直す（確実で簡単なため）。

```sh
gh repo clone sofken2/canbadge-order-system
cd canbadge-order-system
```

続けて次を実行する。

```sh
bun install
bun run dev               # 全 app を起動
```

`.env` は、ポートを変えたいときだけ用意すればよい（`cp .env.example .env`、Windows の PowerShell では `Copy-Item .env.example .env`）。なくても `.env.example` の値で動く。

`bun run db:reset`（DB 作成とサンプルデータ投入）は、DB（T05）とサンプルデータ（T06）ができるまでは「未実装」と表示するだけ。

起動できたら、ブラウザで http://localhost:3000/（来場者向け）と http://localhost:3001/（スタッフ向け）を開く。どちらも「API: OK (ok)」と出れば、画面から api までつながっている。URL とポートの一覧は README の「コマンド」にある。**ここまでできたら環境構築は完了**。手順どおりに動かなかった箇所は、この手順書を直す PR を出すのが最初の貢献になる。

---

## 第3部：日々の作業の流れ

### 3-1. タスクを選ぶ

1. Projects ボードの「未着手」から Issue を選ぶ
2. Issue に「やります」とコメントし、自分を Assignees に追加する
3. 管理者が依存関係を確認して承認したら、ボードで「作業中」に移す

同時に持てるのは1〜2件まで。1週間動きがなければ、確認のうえアサインを外して「未着手」に戻す。

### 3-2. ブランチを作って作業する

```sh
git switch main
git pull
git switch -c feat/W03-order-status   # <種別>/<IssueID>-<短い説明>
```

コミットはこまめに行う。

```sh
git add .
git commit -m "feat(web): 注文状況ページにQRを表示"
```

### 3-3. PR を出す

```sh
git push -u origin feat/W03-order-status
gh pr create --draft --fill
```

- 作業途中でも **Draft PR** で早めに出す。進み具合が他の人にも見えるようにするため
- PR 本文に `Closes #<Issue番号>` を書くと、マージ時に Issue が自動で閉じる
- 完成したら `gh pr ready` で Draft を解除し、ボードで「レビュー待ち」に移す
- `packages/shared`（契約）を変更する PR は、管理者（契約オーナー）のレビューが必須

### 3-4. main の変更を取り込む

他の人の PR がマージされて自分のブランチが古くなったら、次で取り込む。

```sh
git fetch origin
git rebase origin/main
```

コンフリクトが出たら、該当ファイルを直して `git add <ファイル>` → `git rebase --continue`。分からなくなったら `git rebase --abort` で元に戻して相談する。rebase 後の push は `git push --force-with-lease` を使う（`--force` は使わない）。

### 3-5. マージ後

```sh
git switch main
git pull
```

---

## 第4部：Claude Code を使う（任意）

### 4-1. 利用条件

Claude Code は Claude の有料プラン（Pro・Max・Team・Enterprise）または Anthropic Console のアカウントが必要。無料プランでは使えない。使わなくても開発には参加できる。

### 4-2. インストール

| OS | コマンド |
| --- | --- |
| Windows（PowerShell） | `irm https://claude.ai/install.ps1 \| iex` |
| macOS / Linux | `curl -fsSL https://claude.ai/install.sh \| bash` |

Windows でネイティブに使う場合は、事前に Git for Windows が必要。インストール後に確認する。

```sh
claude --version
claude doctor
```

初回は `claude` を実行するとブラウザが開くので、ログインする。

### 4-3. 起動する場所

**必ずリポジトリの直下で起動する。**

```sh
cd canbadge-order-system
claude
```

直下の `CLAUDE.md`（プロジェクト全体のルール）が起動時に読み込まれる。デザイン用のスキル Hallmark（`.claude/skills/hallmark`）も、直下で起動すれば自動で使える。画面を作るときは「Hallmark で作って」、点検するときは「hallmark audit <ファイル>」のように指示する。`packages/shared` などのサブディレクトリにある `CLAUDE.md` は、Claude がそのディレクトリのファイルを読んだときに追加で読み込まれる。

### 4-4. 指示の出し方

Issue 単位で、**先に計画を出させてから実装させる**。

```text
Issue #12（W03 注文状況ページ）を gh で読んで、関連する仕様書の章も確認したうえで、
実装計画を箇条書きで出して。まだコードは書かないで。
```

計画に問題がなければ実装を指示する。終わったら型チェック・lint・テストが通っているか確認させる。

```text
その計画で実装して。終わったら typecheck・lint・test を実行して結果を教えて。
```

### 4-5. 注意点

- **生成されたコードは自分で読んで理解してから PR を出す。** レビューで説明できないコードはマージしない
- 契約（`packages/shared`）の変更を提案されたら、自分で判断せず管理者に相談する
- 個人的な設定（自分用のメモや好み）は `CLAUDE.local.md` に書く。このファイルはコミット対象外
- プロジェクト共通のルールを変えたいときは、`CLAUDE.md` を直す PR を出す

---

## よくあるトラブル

| 症状 | 対処 |
| --- | --- |
| `bun` / `gh` / `claude` が見つからない | ターミナルを開き直す。それでもだめなら PATH を確認する |
| `git push` で認証エラー | `gh auth status` で確認し、必要なら `gh auth login` をやり直す |
| 最初の push で `src refspec main does not match any` | コミットがまだない。1-3 の `git commit` を先に実行する |
| クローンしたのにファイルがない | 管理者の最初の push より前にクローンしている。フォルダを削除してクローンし直す |
| 差分がすべての行で出る | 改行コードの問題。`.gitattributes` があるか確認し、`git add --renormalize .` を実行する |
| `bun install` 後に型エラーが大量に出る | main を最新にしたか確認する |
| DB の中身がおかしい | `bun run db:reset` で作り直す（ローカルのデータは消える） |
