# AGENTS.md

人と AI エージェント（Claude Code ほか）が共通で読む、このリポジトリの開発ガイド。
`CLAUDE.md` はこのファイルへの symlink なので、編集はこのファイルに対して行う。

## プロジェクト

- JPHACKS 2026 の作品（チーム 5 人）。プロダクトの概要は `README.md` に書く。
- 技術スタック: iOS は SwiftUI のネイティブアプリ、バックエンドは TypeScript on Cloudflare Workers ＋ Durable Objects。外部 API（Azure の発音評価・Claude）はバックエンドだけが呼ぶ（[ADR](./docs/adr/20261021-adopt-swiftui-app-and-cloudflare-workers-backend.md)）。iOS のプロジェクトの作り方と仮のデータの切り替えは [ADR](./docs/adr/20261024-build-ios-app-with-xcodegen-and-build-configs.md)。アプリとバックエンドのコードを足したら、下の「リポジトリ構成」「コマンド」も更新する。
- 仕様の正本は `docs/design/`（[ADR](./docs/adr/20261021-keep-product-specs-in-docs-design.md)）。入口は `docs/design/usecase.md`。

## リポジトリ構成

```
.github/          PR・issue テンプレート、ラベル定義、Actions（pr-checks・format-check・Discord 通知・backend の検査・PR ごとのプレビュー・デプロイ）
.claude/skills/   共有の Claude Code skill（.agents は .claude への symlink）
backend/          バックエンド（Hono on Cloudflare Workers）。PR ごとにプレビュー、main に入るとデプロイされる
backend/src/scenes/pool/ AI で作り置いた場面（配置の JSON、scenenglish.scene/2）と、級ごとの一覧の index.json。今は絵で選んだ 48 場面（gen-v2-…）。Worker に同梱し、iOS の Mock もビルドで写して使う
backend/src/parts/ その場で部品を作る（Claude が書いた部品表 → USDZ の組み立て、形の検査、R2 に置く、部品の ID の規約）。中身は backend/README.md
docs/adr/         設計・運用の意思決定ログ
docs/design/      仕様の正本（使い方・画面の流れ・アーキテクチャ・採点・コスト対策）
docs/design/ui/   画面設計書の元データ（screens/*.md、仮の画面の画像）
docs/app-store/   App Store への申請の手順と入れる値、スクリーンショット（プライバシーポリシーはルートの PRIVACY_POLICY.md）
assets/scenes/    手作りの 6 場面の 3D シーン（USDZ）と場面の説明（JSON）。scripts/scene/ が Blender で生成する。今は遊べる場面から外している（docs/adr/20261111-score-only-with-checklist-and-drop-handmade-scenes.md）
assets/parts/     シーンを組み立てる作り置きの部品（USDZ とメタデータの JSON）。scripts/scene/parts.py が Blender で生成する
assets/title/     タイトル画面（ホーム）の広告の 3D。今は広告の見本のハッカソン会場（staging だけで出す）。scripts/scene/hackathon.py が Blender で生成し、Worker が静的アセットとして配る（assets/.assetsignore）
ios/              iOS アプリ（SwiftUI）と unit test（ios/NG2622Tests）。xcodegen で ios/project.yml から作り、.xcodeproj は commit しない
ios/Packages/     iOS のローカルの Swift パッケージ。BackendAPI は backend/openapi.json から API の型をビルドのたびに作る
scripts/          規約の検査スクリプト、GitHub 設定スクリプト、画面設計書の生成（ui-spec/）、3D シーンの生成（scene/）、アプリのアイコンの生成（app-icon/）
tests/            scripts/ の self-test
lefthook.yml      git hook（pre-commit / commit-msg / pre-push）
biome.json        Biome（TypeScript・JSON などの整形と lint）の設定
```

## はじめに（各メンバーが一度だけ行う）

```sh
brew install lefthook gh pnpm
brew install xcodegen   # Mac でアプリをビルドする人だけ
lefthook install
pnpm install       # Biome を入れる（commit 時の整形に使う）
cp ios/Config/Local.xcconfig.example ios/Config/Local.xcconfig   # アプリをビルドする人だけ。自分のチーム ID と bundle ID を書く
```

## コードの整形

- TypeScript・JSON などは Biome で整形する。インデントはスペース 2（[ADR](./docs/adr/20261023-format-with-biome.md)）。Swift のフォーマッターは入れていない。
- commit すると、lefthook の pre-commit が stage したファイルを自動で整形し、stage し直す。
- PR では format-check（GitHub Actions）が整形し忘れを検査する。merge の条件にはしていない。
- Markdown は整形しない。

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

merge するには、PR のブランチが最新の main を含んでいる必要がある（古ければ「Update branch」で追従し、pr-checks の再実行を待つ。[ADR](./docs/adr/20261112-require-up-to-date-branch-before-merge.md)）。

main への直接 push と force push は ruleset が拒否する。admin も例外にしていない。
ただし repo の admin は、PR を merge するときに限り approve と pr-checks を待たずに merge できる（急ぎの場合の逃げ道で、普段は使わない）。

PR を作成すると（draft は ready for review にしたときに）Discord に通知が届く。webhook URL は repo の Actions secret `DISCORD_WEBHOOK_URL` に置いていて、ファイルには書かない。

## コマンド

```sh
pnpm format                                 # Biome で整形と lint の自動修正（pnpm format:check で検査のみ）
bash tests/run-tests.sh                     # 検査スクリプトの self-test
scripts/setup-github-repo.sh --dry-run      # GitHub 設定（ラベル・merge 方式・ruleset）の差分確認
python3 scripts/ui-spec/build.py            # 画面設計書 docs/design/ui/build/ui-spec.html を生成（要 graphviz・librsvg）
python3 scripts/overview/build.py           # チーム向けの説明資料 docs/design/overview/overview.html を生成（生成物も commit する）
uv run --with matplotlib python3 scripts/revenue/build.py  # 収益モデルの試算のグラフ入りの HTML を docs/design/research/build/ に生成（前提はスクリプトの先頭。commit しない）
python3 scripts/scene/preview_parts.py      # 3D の部品を 1 個ずつ回して見る assets/parts/build/preview.html を生成（要 Blender・npm。commit しない）
blender --background --factory-startup --python scripts/scene/park.py  # 3D シーン assets/scenes/park.usdz と画像を生成（classroom.py・station.py・rainy_street.py・beach.py・cafe.py も同じ。要 Blender 4.5 LTS）
blender --background --factory-startup --python scripts/scene/hackathon.py  # タイトル画面の広告の見本（ハッカソン会場）assets/title/hackathon.usdz と画像を生成（要 Blender 4.5 LTS）
blender --background --factory-startup --python scripts/scene/parts.py  # 部品 assets/parts/<id>/1.usdz・1.json と index.json を生成（-- --only <id> で 1 個だけ。確かめは check_parts.py、-- --sheet で一覧の画像も作る）
python3 -I scripts/scene/export_materials.py  # parts.py の材質を backend/src/parts/materials.json に書き出す（その場で部品を作るときの材質。parts.py の材質を変えたら回して commit する）
blender --background --factory-startup --python scripts/scene/render_layout.py -- scripts/scene/samples/*.json --out <dir>  # 配置の JSON（scenenglish.scene/2）を部品で組んで <dir>/<名前>.png に描く。下の欄に見本の答えと checklist を全部書く（AI が作った場面の目での確かめ用）
python3 scripts/scene/make_pool.py --url http://localhost:8799 --out <dir> --count 14  # 作り置きの場面の候補を手元の wrangler dev でまとめて作り、PNG と一覧の画像を作る（手順は backend/README.md の「作り置きの場面を作る」）
(cd backend && CLAUDE_API_KEY=... pnpm tsx scripts/make-pool-v2.ts <dir>)  # 級に合った作り置きの場面（scenenglish.scene/2）の候補をまとめて作る（Claude を呼ぶので費用がかかる。手順は backend/README.md の「/2 の作り置きをまとめて作る」）
(cd backend && pnpm install && pnpm dev)    # バックエンドを手元で起動（http://localhost:8787/health）
(cd backend && pnpm typecheck)              # バックエンドの型チェック
(cd backend && pnpm test)                   # バックエンドの単体テスト（関係 → 座標の計算・場面の生成と裏取り・チェックリストの採点・部屋など）
(cd backend && pnpm openapi)                # API の型から backend/openapi.json を生成（iOS が読む。生成物も commit する）
(cd ios && xcodegen)                        # ios/NG2622.xcodeproj を作る（clone 後と ios/project.yml を変えたあと）
open ios/NG2622.xcodeproj                   # scheme「NG2622 Mock」（仮のデータ）か「NG2622 Live」（BACKEND_URL の本物のバックエンド）を選んでビルド。Mock の振る舞い（参加者の数・切断など）は ios/Config/Local.xcconfig の MOCK_* で、待合のシーンの選び方（難易度か一覧か）は SCENE_PICK で、Mock のホームの 3D を広告の見本（ハッカソン会場）にするのは TITLE_DIORAMA = hackathon で変える（Live はサーバーの GET /title が決める）（ios/Config/Local.xcconfig.example）
# ↑ 初めてビルドすると「Validate plug-in “OpenAPIGenerator”」のエラーが出るので、Issue navigator で Trust & Enable を押す（Mac ごとに一度。generator の版を上げたらもう一度）
# API の型（import BackendAPI）は backend/openapi.json からビルドのたびに作られ、commit しない。openapi.json が変わればビルドし直すだけでよい
xcodebuild -project ios/NG2622.xcodeproj -scheme "NG2622 Mock" -destination 'generic/platform=iOS Simulator' -skipPackagePluginValidation build   # コマンドラインでビルドするときは -skipPackagePluginValidation を付ける
(cd ios/Packages/BackendAPI && swift test)  # WebSocket のメッセージと GET /title の応答（日時を含む）が openapi.json から作った型で読めるか、BearerToken が合言葉を付けるかを確かめる（Mac で動く。シミュレータは要らない）
xcodebuild -project ios/NG2622.xcodeproj -scheme "NG2622 Mock" -destination 'platform=iOS Simulator,name=iPhone 18 Pro' -skipPackagePluginValidation test   # アプリの unit test（ios/NG2622Tests。部屋のメッセージの変換など）
TEST_RUNNER_RECORDS_SHOT_DIR=<dir> xcodebuild -project ios/NG2622.xcodeproj -scheme "NG2622 Mock" -destination 'platform=iOS Simulator,name=iPhone 18 Pro Max' -skipPackagePluginValidation -only-testing:NG2622UITests/RecordsScreens -only-testing:NG2622UITests/WeakPointsScreens test   # きろく・設定の画面（RecordsScreens）と、きろく → 苦手の画面（WeakPointsScreens。保存済みの記録は読まず、例の記録だけで数える）を Mock で通しで開き、<dir> に PNG を書き出す（例の記録の数は MOCK_SAMPLE_RECORDS）
TEST_RUNNER_ASOBU_SHOT_DIR=<dir> xcodebuild -project ios/NG2622.xcodeproj -scheme "NG2622 Mock" -destination 'platform=iOS Simulator,name=iPhone 18 Pro Max' -skipPackagePluginValidation -only-testing:NG2622UITests/AsobuScreens test   # 最初の画面 → ホーム →「あそぶ」→ 待合 →「他のルーム」→ 別の部屋を Mock で通しで開き、<dir> に PNG を書き出す（回転中の 3D のコマも撮る）
# App Store に出すときは scheme「NG2622 Store」（Release-Store。Local.xcconfig を読まない）で Archive する。手順は docs/app-store/README.md
blender --background --factory-startup --python scripts/app-icon/render_park.py && uv run --with pillow python3 scripts/app-icon/build.py  # アプリのアイコンを作り直す
TEST_RUNNER_LIVE_BACKEND_URL=http://localhost:8787 xcodebuild -project ios/NG2622.xcodeproj -scheme "NG2622 Live" -destination 'platform=iOS Simulator,name=iPhone 18 Pro' -skipPackagePluginValidation test   # 手元のバックエンド（pnpm dev）に LiveGameClient を 2 つつなぐ結合テストも動かす
```

## AI エージェント向けの補足

- 着手前に前提が曖昧なら `grill-me`（仕様書があれば `grill-spec`）で認識を合わせる。
- issue から作業を始めるときは `fix-issue`、commit メッセージは `git-commit` の skill を使う。
- 長く効く判断（技術選定・リポジトリ全体のルール）は `manage-adrs` に従い `docs/adr/` に記録する。
- 他のメンバーのブランチや PR を勝手に書き換えない。PR の merge は人が行う。
- secret（`.env` など）を commit しない。
