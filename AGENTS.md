# AGENTS.md

人と AI エージェント（Claude Code ほか）が共通で読む、このリポジトリの開発ガイド。
`CLAUDE.md` はこのファイルへの symlink なので、編集はこのファイルに対して行う。

## プロジェクト

- JPHACKS 2026 の作品（チーム 5 人）。プロダクトの概要は `README.md` に書く。
- 技術スタック: iOS は SwiftUI のネイティブアプリ、バックエンドは TypeScript on Cloudflare Workers ＋ Durable Objects。外部 API（Azure の発音評価・Claude）はバックエンドだけが呼ぶ（[ADR](./docs/adr/20261021-adopt-swiftui-app-and-cloudflare-workers-backend.md)）。アプリとバックエンドのコードを足したら、下の「リポジトリ構成」「コマンド」も更新する。
- 仕様の正本は `docs/design/`（[ADR](./docs/adr/20261021-keep-product-specs-in-docs-design.md)）。入口は `docs/design/usecase.md`。

## リポジトリ構成

```
.github/          PR・issue テンプレート、ラベル定義、Actions（pr-checks・Discord 通知・backend の検査・PR ごとのプレビュー・デプロイ）
.claude/skills/   共有の Claude Code skill（.agents は .claude への symlink）
backend/          バックエンド（Hono on Cloudflare Workers）。PR ごとにプレビュー、main に入るとデプロイされる
docs/adr/         設計・運用の意思決定ログ
docs/design/      仕様の正本（使い方・画面の流れ・アーキテクチャ・採点・コスト対策）
docs/design/ui/   画面設計書の元データ（screens/*.md、仮の画面の画像）
scripts/          規約の検査スクリプト、GitHub 設定スクリプト、画面設計書の生成（ui-spec/）
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
ただし repo の admin は、PR を merge するときに限り approve と pr-checks を待たずに merge できる（急ぎの場合の逃げ道で、普段は使わない）。

PR を作成すると（draft は ready for review にしたときに）Discord に通知が届く。webhook URL は repo の Actions secret `DISCORD_WEBHOOK_URL` に置いていて、ファイルには書かない。

## コマンド

```sh
bash tests/run-tests.sh                     # 検査スクリプトの self-test
scripts/setup-github-repo.sh --dry-run      # GitHub 設定（ラベル・merge 方式・ruleset）の差分確認
python3 scripts/ui-spec/build.py            # 画面設計書 docs/design/ui/build/ui-spec.html を生成（要 graphviz・librsvg）
python3 scripts/overview/build.py           # チーム向けの説明資料 docs/design/overview/overview.html を生成（生成物も commit する）
(cd backend && pnpm install && pnpm dev)    # バックエンドを手元で起動（http://localhost:8787/health）
(cd backend && pnpm typecheck)              # バックエンドの型チェック
```

## AI エージェント向けの補足

- 着手前に前提が曖昧なら `grill-me`（仕様書があれば `grill-spec`）で認識を合わせる。
- issue から作業を始めるときは `fix-issue`、commit メッセージは `git-commit` の skill を使う。
- 長く効く判断（技術選定・リポジトリ全体のルール）は `manage-adrs` に従い `docs/adr/` に記録する。
- 他のメンバーのブランチや PR を勝手に書き換えない。PR の merge は人が行う。
- secret（`.env` など）を commit しない。
