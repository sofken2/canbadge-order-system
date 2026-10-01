# .claude/skills

Claude Code をリポジトリ直下で起動すると、ここのスキルが自動で使えるようになる。

| スキル | 内容 | 取得元 | 版 | ライセンス |
| --- | --- | --- | --- | --- |
| `hallmark` | anti-AI-slop のデザインスキル。画面の作成・点検（`hallmark audit`）に使う（`docs/spec.md` 6.4） | https://github.com/nutlope/hallmark の `skills/hallmark/` | v1.1.0（コミット `13ac0ec`、2026-08-06） | MIT（`hallmark/LICENSE`） |

## 更新するとき

取得元の `skills/hallmark/` をそのまま上書きし、上の表の版を書き換える。中身を直接編集しない（このプロジェクト固有の決まりは `design.md` と `docs/spec.md` 6.4 に書く）。
