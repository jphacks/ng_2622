# AGENTS.md

人と AI エージェント（Claude Code ほか）が共通で読む、このリポジトリの開発ガイド。
`CLAUDE.md` はこのファイルへの symlink なので、編集はこのファイルに対して行う。

## プロジェクト

- JPHACKS 2026 の作品（チーム 5 人）。プロダクトの概要は `README.md` に書く。
- 技術スタックは未定。決まったら下の「リポジトリ構成」「コマンド」を更新し、選定理由を ADR に残す。

## リポジトリ構成

```
.github/          PR・issue テンプレート、ラベル定義、Actions（pr-checks・Discord 通知）
.claude/skills/   共有の Claude Code skill（.agents は .claude への symlink）
docs/adr/         設計・運用の意思決定ログ
scripts/          規約の検査スクリプトと GitHub 設定スクリプト
tests/            scripts/ の self-test
lefthook.yml      git hook（commit-msg / pre-push）
```

## はじめに（各メンバーが一度だけ行う）

```sh
brew install lefthook gh
lefthook install
```

## 開発フロー

1. 作業を issue にしておくと、誰が何をしているかが見えやすい（必須ではない）。
2. `origin/main` からブランチを切る。名前は `<type>/<slug>`。issue があれば `<type>/<issue番号>-<slug>` にする。
   例: `feat/login-form`、`fix/12-api-timeout`
3. commit の件名は Conventional Commits 形式で書く。説明は日本語でも英語でもよい。
   例: `feat: ログイン画面を追加`、`fix(api): handle timeout`
4. PR を作る。タイトルも Conventional Commits 形式にする（squash merge でそのまま main の commit 件名になる）。
5. 自分以外の 1 人の approve と pr-checks の pass を待ち、PR 作成者が **Squash and merge** する。
   approve 後に push すると approve は取り消されるので、もう一度レビューを頼む。

使える type: `feat` `fix` `docs` `style` `refactor` `perf` `test` `build` `ci` `chore` `revert`
（一覧は `scripts/check-commit-msg.sh` で定義している）

## 規約の強制

| 規約 | 手元（lefthook） | GitHub |
|---|---|---|
| commit 件名の形式 | commit-msg | なし（squash で PR タイトルに置き換わる） |
| ブランチ名 | pre-push | pr-checks |
| PR タイトルの形式 | なし | pr-checks |
| PR 必須・1 approve・squash のみ | なし | ruleset `main-protection` |

main への直接 push と force push は ruleset が拒否する。admin も例外にしていない。

PR を作成すると（draft は ready for review にしたときに）Discord に通知が届く。webhook URL は repo の Actions secret `DISCORD_WEBHOOK_URL` に置いていて、ファイルには書かない。

## コマンド

```sh
bash tests/run-tests.sh                     # 検査スクリプトの self-test
scripts/setup-github-repo.sh --dry-run      # GitHub 設定（ラベル・merge 方式・ruleset）の差分確認
```

## AI エージェント向けの補足

- 着手前に前提が曖昧なら `grill-me`（仕様書があれば `grill-spec`）で認識を合わせる。
- issue から作業を始めるときは `fix-issue`、commit メッセージは `git-commit` の skill を使う。
- 長く効く判断（技術選定・リポジトリ全体のルール）は `manage-adrs` に従い `docs/adr/` に記録する。
- 他のメンバーのブランチや PR を勝手に書き換えない。PR の merge は人が行う。
- secret（`.env` など）を commit しない。
