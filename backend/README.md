# backend

Hono on Cloudflare Workers のバックエンド。構成は [`docs/design/architecture.md`](../docs/design/architecture.md)。

## 手元で動かす

pnpm を使う（版は `package.json` の `packageManager` で固定。pnpm 10 以上なら自動でその版に切り替わる）。

```sh
pnpm install
pnpm dev              # http://localhost:8787/health が ok を返す
pnpm typecheck
pnpm openapi          # openapi.json を生成し直す
```

- API の画面（Swagger UI）: http://localhost:8787/docs
- OpenAPI: http://localhost:8787/openapi.json
- `/docs`・`/openapi.json`・`/dev/score` は `ENABLE_DEV_ROUTES=true` のときだけ開く。`pnpm dev` が自動で付けるので、手元では何もしなくてよい。本番とプレビューでは 404 になる。

## 採点（`src/scoring/`）

1 人分の音声（WAV）とシーン ID と、端末（SpeechAnalyzer）で文字起こしした発話から、内容・表現・話し方の点数と講評を返す。部屋からは `score(env, wav, sceneId, deviceTranscript?)` と `ScoreResult`（`src/scoring/types.ts`）だけを使う。

- 文字起こし: 端末の文字起こしを使う。無いか空のときは Azure の文字起こしを使う。
- 話し方: Azure の発音評価（REST）。端末の文字起こしがあれば正解文として渡す。Accuracy・Fluency・Prosody の平均。
- 内容・表現・講評: Claude（既定は `claude-haiku-5-5`）を 1 人につき 1 回呼ぶ、チェックリストの採点の 1 通り（`checklistGrade.ts` の `gradeWithChecklist`。[ADR](../docs/adr/20261110-score-content-with-checklist-f1.md)、[ADR](../docs/adr/20261111-score-only-with-checklist-and-drop-handmade-scenes.md)）。
  - 渡すもの: 級、級の文法の一覧（`src/scenes/grades.ts` の `GRADES` から。下の級の分も含む）、関係つきの場面の情報（`layout.ts`）、場面の `checklist`、見本の答え（`description`）、Azure の 3 つの点、文字起こし。
  - Claude が返すのは、発話を事実 1 つずつに分けた描写と判定・表現の点とその根拠・次に伸ばす一つ・言い換え。内容の点は返させず、`checklist.ts` が描写から計算する（言えた R と正しさ P の F1）。
  - 3 語以上の発話に表現 0 点か空の根拠が返ったら、同じ入力で 2 回まで呼び直す。
  - 講評（`feedback`）は、次に伸ばす一つ（内容のときは項目の `id` と、合計の点の伸び `gain`）・言い換え（元の文が文字起こしにあるときだけ）・話し方のコツ（Azure の点から `feedback.ts` が作る）。
  - 結果（`ScoreResult`）には内容の内訳（`breakdown`: 描写の一覧・項目ごとの達成・言えたと正しさの分子と分母）が入り、部屋が `results` の `content` として全員に配る。
- 3 語より短い発話は Claude を呼ばず、内容・表現を 0 点にする。
- 合計は `SCORE_WEIGHTS`（内容,表現,話し方。既定 `50,25,25`）で重み付けする。
- `SCORING_MODE=fixed` で外部 API を呼ばず固定の点数を返す。`wrangler.jsonc` で本番は live、PR のプレビューは fixed にしてある。本番の `AZURE_API_KEY` と `CLAUDE_API_KEY` は `wrangler secret put` で Worker に登録する。採点に使う Claude は `CLAUDE_MODEL` と `CLAUDE_EFFORT`（`low`・`medium`・`high`・`xhigh`・`max`）で変えられ、本番は `wrangler.jsonc` で Sonnet 5.5 の low にしてある。書かなければ Haiku 5.5 の high。
- 採れるのは、作り置きの場面（`src/scenes/pool/`）と、部屋が AI で作った場面（`scenenglish.scene/2`）。手作りの 6 場面（`park` など）は外した（3D のファイルは `assets/scenes/` に残っている）。
- `POST /score` は部屋を通さない採点の口（`ENABLE_DEV_ROUTES=true` のときだけ開く）。配置の JSON（`difficulty`・`checklist`・`items`・`description`）と文字起こしを受け、同じ採点で内容と表現の点・内訳・講評を返す（話し方は付けない）。

## 作り置きの場面（`src/scenes/pool/`）

AI で作り置いた場面（配置の JSON、`scenenglish.scene/2`）と、級ごとの例と出題の候補を書いた `index.json`。今あるのは仮の場面（`temp-…`、級ごとに例 1 つ・出題 1 つ）で、人が確かめた場面ができたら差し替える。形と足し方は [`src/scenes/pool/README.md`](./src/scenes/pool/README.md)。iOS の Mock もビルドのときにここから写して使う。

### 手元で採点を試す

`backend/.dev.vars` に次を書いて `pnpm dev` する（値は repo 直下の `.env` と同じ）。

```sh
ENABLE_DEV_ROUTES=true
SCORING_MODE=live
AZURE_API_KEY=...
AZURE_LOCATION=...
CLAUDE_API_KEY=...
```

```sh
# 16 kHz・16 bit・モノラルの WAV を作って送る（1 回で Azure と Claude を 1 回ずつ呼ぶ）
say -o test.wav --data-format=LEI16@16000 "A boy is running in the park and a dog is running to a red ball."
curl -F audio=@test.wav -F sceneId=temp-eiken-pre2-park http://localhost:8787/dev/score
# 端末の文字起こしの代わりに transcript も付けるとき
curl -F audio=@test.wav -F sceneId=temp-eiken-pre2-park -F "transcript=A boy is throwing a ball." http://localhost:8787/dev/score
```

`/dev/score` は `ENABLE_DEV_ROUTES=true` のときだけ開く（`pnpm dev` が自動で付ける）。デプロイ先には入れない。

### チェックリストの採点のぶれを測る

チェックリストの F1 の採点（`src/scoring/checklist.ts` の計算と `checklistGrade.ts` の `gradeWithChecklist`。[ADR](../docs/adr/20261110-score-content-with-checklist-f1.md)）のぶれは、`CLAUDE_API_KEY=... pnpm tsx scripts/measure-scoring-baseline.ts <結果の JSON> [1 答えあたりの回数（既定 5）] [費用の上限ドル（既定 2.5）]` で確かめる。試験用の 3 場面（`test/fixtures/checklist-eiken-*.json`、級ごとに 1 つ）に、用意した答え（見本どおり・正しい一文だけ・細部だけ・誤り・的外れなど 10 通り）を同じ回数ずつ採点させ、答えごとの内容と表現の点の並び・幅・かかった時間を表と JSON に出す。合格は、どの答えも内容の点の幅（最大 − 最小）が 5 点以内で、合格しなければ終了コード 1 で終わる。表現の点の幅と、表現が 0 点になった答え、呼び直した回数（3 語以上の発話に表現 0 点か空の根拠が返ると、`gradeWithChecklist` が同じ入力で 2 回まで呼び直す）も出すが、参考で合否には入れない。各回の表現の点の根拠（`expressionBasis`）は JSON に残る。Claude を実際に呼ぶ（既定で 150 回）ので費用がかかり、上限に達したらそこで止まる。Azure は呼ばず、話し方の 3 つの点は 75 に固定する。級の文法の一覧は、本番の採点と同じく生成の定数（`GRADES`）から作る（その級までの分と、一つ上の級で足される分）。内容の満点の重みは checklist の項目だけで、一覧に無い正しい描写（その他）は 2 件までのおまけなので、見本どおりの答えは 100 点になる（[ADR](../docs/adr/20261111-count-other-claims-as-bonus-and-require-actions-for-items.md)）。2026-11-11 の実測（今の指示、1 答え 3 回・計 90 回、1.52 USD）は合格で、30 通りすべてで内容の点の幅が 5 点以内だった（28 通りは幅 0、残りは 5 と 1）。見本どおりは 3 級とも 100 点、名前だけは 33・18・13 点、場面にないことは 0 点、前置詞の誤りは 64・56・43 点。表現の点の幅は最大 10（参考）で、表現が 0 点になった答えは無く、呼び直しは 2 回。時間は答えごとの値で 1 回 2.3〜6.7 秒。

## 作り置きの場面を作る（`src/scenes/`）

形と流れの正本は [`docs/design/scene-protocol.md`](../docs/design/scene-protocol.md) の「AI で場面を作り置く」。場面は遊ぶ前に手元でまとめて作り、PNG を目で見て良いものだけを repo に入れる。本番では作らない。

| API | 中身 |
| --- | --- |
| `GET /parts` | 部品のメタデータの一覧 `{ parts }`。Worker に同梱した `src/scenes/parts.json` を返す |
| `GET /scenes/{sceneId}/layout` | 場面の配置の JSON。作り置きの場面はそのまま、部屋が作った場面は `?room=<部屋のコード>` を付けて取る。Live のアプリはこれを読んで部品を並べる |
| `POST /scenes/generate` | 作り置き用。`{ difficulty, theme? }`（`difficulty` は `eiken-3`・`eiken-pre2`・`eiken-2`）から 2 段の生成で場面を作り、配置の JSON（`scenenglish.scene/2`。`id` は `gen-` ＋ 10 文字）を `200` でそのまま返す。保存はしない。裏取りで落ちたら、理由を指示に足して 2 回まで作り直す。`theme` を省けば指示の中のテーマの一覧から Claude が選ぶ。`Authorization: Bearer <SCENE_WRITE_TOKEN>` が要る（違えば 401 `unauthorized`）。失敗は 422 `generation_refused`（Claude が断った）・422 `generation_failed`（途中で止まった・形が違う・作り直しても裏取りを通らない）・503 `generation_unavailable`（タイムアウト・API の失敗・止めてある） |

- `parts.json` は `assets/parts/index.json` の写し。部品を足したら写し直す（`test/parts.test.ts` が突き合わせる）。
- 生成（`generate-v2.ts`。下の「英文を先に書く 2 段の生成」）: Claude に座標を書かせず、1 回目に見本の答えとチェックリスト、2 回目に部品どうしの関係（`on`・`next_to`・`sit_on` など）を JSON Schema の形で書かせる。部品の ID は schema の `enum`。モデルと effort は `CLAUDE_SCENE_MODEL`・`CLAUDE_SCENE_EFFORT`（既定 `claude-sonnet-5-5` の `low`）、SDK の再送は使わない。共通の物（テーマ・場面の決まり・items の形・失敗の種類）は `generate.ts` にある。
- 座標の計算（`compose.ts`、純粋な関数。テストは `test/compose.test.ts`）: 9 区画（一辺 8/3 m）、地面に置く物は区画の中で size が重ならない点を探す、幅いっぱいの背景の壁は奥の端に付ける、`on` は相手の `anchors.top`、`sit_on` は相手の `seat` に人の `hip` を合わせる、横・前・後ろは相手の size ＋ 10 cm の隙間、`above` は相手の高さ＋ 0.3 m。配置の JSON（`/2`）にまとめるのは `compose-v2.ts`。
- 生成は `SCENE_GENERATION=on` のときだけ動く。`wrangler.jsonc` では本番もプレビューも `off`。

### 部屋で AI に作らせる

ホストが `start` を `difficulty` で送ると、`SCENE_GENERATION=on` で、その部屋で試した回数が 20 回未満なら、部屋（`Room` の DO）が場面を作る。

- 部屋は phase `generating` の `room` を配ってから、2 段の生成で Claude を 2 回呼ぶ（合計 10 秒まで。やり直さず、裏取りで落ちても作り直さない）。できたら今までどおり `room`（`playing`）・`round`（`sceneId` だけ）・`progress` を配る。
- タイムアウト・断られた・形が違う・API の失敗・裏取りで落ちたときは、黙って同じ難易度の作り置きの場面にする。スイッチが off か 20 回を超えたら、今までどおり `generating` を出さずに作り置きから選ぶ。試した回数は失敗も数える（`RoomState.generationCount`）。
- 作っている間にホストが `leave` すると生成を止め、残った人で作り置きの場面のラウンドを始める（切断しただけでは止めない）。
- 作った配置は DO の保存領域（キー `layout:<sceneId>`）に置き、部屋が消えるときに一緒に消える。アプリは `GET /scenes/{sceneId}/layout?room=<部屋のコード>` で取る。採点も `beginGrading` が返す配置を使う。
- 手元で試すときは、`backend/.dev.vars` に `CLAUDE_API_KEY` と `SCENE_GENERATION=on` を書いて `pnpm dev` する。本番では `CLAUDE_API_KEY`（採点と同じ secret）が要る。

### 手元で作り置く

`backend/.dev.vars` に `CLAUDE_API_KEY` を書いておく。生成のスイッチと合言葉は、別の env ファイル（`.dev.vars*` は git に入らない）に書いて渡す。`--var` で渡すと合言葉が ps に出るので使わない。

```sh
cd backend
printf 'SCENE_GENERATION=on\nSCENE_WRITE_TOKEN=%s\n' "$(openssl rand -hex 24)" > .dev.vars.scene
pnpm exec wrangler dev --env-file .dev.vars --env-file .dev.vars.scene --port 8799   # effort を変えるときは .dev.vars.scene に CLAUDE_SCENE_EFFORT=high など

# 別の端末で。make_pool.py は合言葉を環境変数から読む
cd <repo>
set -a; . backend/.dev.vars.scene; set +a
python3 scripts/scene/make_pool.py --url http://localhost:8799 --out <出力先> --difficulty eiken-3 eiken-pre2 eiken-2 --count 14
```

`<出力先>/<difficulty>/<id>.json`・`.png`（`render_layout.py` で描く。要 Blender）、難易度ごとの `contact_sheet.png`（要 ffmpeg）、所要時間の表 `times.md` ができる。テーマは難易度ごとにずらして一覧を回す（`--theme` で固定、`--no-theme` で Claude に選ばせる）。終わったら wrangler dev を止め、`.dev.vars.scene` を消す。

### 英文を先に書く 2 段の生成（`scenenglish.scene/2`）

級（`eiken-3`・`eiken-pre2`・`eiken-2`）に合った場面を作る生成（[ADR](../docs/adr/20261110-write-grade-sentences-before-scene-parts.md)）。部屋での生成も `POST /scenes/generate` もこれを使う（`usecases/scenes.ts` の `generateScene`）。`generate-v2.ts` が、1 回目に部品の一覧を見せずに英文とチェックリストを書かせ（`generateSentences`。見本の答えを文の配列で書かせ、項目ごとにどの文の事実かを番号で書かせて、`accept` はコードがその文から取る）、`candidates()` が 2 回目に渡す部品を選び（今は全部を返す。後でベクトル検索に差し替える）、2 回目に部品と関係を書かせる（`generateItems`）。級の規則は `grades.ts` の `GRADES`、ポーズで言える動詞と CEFR-J の段階は `pose-verbs.ts` にあり、指示の表も裏取りの数もここから作る。裏取り（`verify.ts`）は、チェックリストの数・`refs` の呼び名が `items` にあるか・`accept` が `description` にあるか・中心の項目の動詞が部品のポーズと級の段階に合うかを確かめ、落ちた理由を文で返す。作り置きを作るときは `generateVerifiedScene` を使う（落ちた理由を指示に足して 2 回まで作り直し、通らなければ `SceneVerificationError`）。座標に直して `/2` の配置の JSON にするのは `compose-v2.ts` の `composeLayoutV2`。級ごとにまとめて作るときは、先に作った場面の要約（`variety.ts` の `summarizeScene`）を入力の `avoid` に渡して違う場面を書かせ、`overusedCauses` で同じ理由の原因（rain など）が 3 場面を超えていないかを数える。時間は `CLAUDE_API_KEY=... pnpm tsx scripts/measure-scene-generation-v2.ts [1 級あたりの回数（既定 20）] [結果の JSON の書き出し先] [--avoid]` で測る（`--avoid` で、同じ級の前の回の要約を渡す）。級ごとに、各回の時間（1 回目・2 回目・合計）と裏取りの結果を出し、最後に第 3 四分位数の表を出す（各段を 1 回だけ呼び、作り直さない。Claude を実際に呼ぶので費用がかかる）。合計の第 3 四分位数が 10 秒を超えていたら、部屋での生成を動かす前に扱いを決める。

### `/2` の作り置きをまとめて作る（`scripts/make-pool-v2.ts`）

級ごとに `generateVerifiedScene` を順に呼び、裏取りを通った場面を `<出力>/<id>.json`（`scenenglish.scene/2`。id は `gen-v2-<級>-<テーマ>-<連番>`、例 `gen-v2-pre2-bus-stop-11`）に書く。テーマは 12 個を順に回し、その級で先に通った場面の要約を次の場面に渡して、似た場面を避けさせる。1 つ落ちても API が失敗しても止まらず、全部の試行（級・テーマ・通ったか・落ちた理由・呼び出しの数・作り直しの数・時間・費用）を `<出力>/log.json` に残し、最後に級ごとの通過の数と費用の表を出す。費用の合計が上限（`--max-usd`、既定 3 ドル）に達したら、次の場面を作らずに止まる。Claude を実際に呼ぶので費用がかかる。キーは環境変数 `CLAUDE_API_KEY` で渡す（引数やファイルには書かない）。

```sh
# mini で。級ごとに 12 場面ずつ試す（既定）
cd backend
CLAUDE_API_KEY=... pnpm tsx scripts/make-pool-v2.ts ~/pool-v2
# 2級だけ、続きの 12 場面（連番 13 から。テーマは一周して公園から）を、上限 2 ドルで
CLAUDE_API_KEY=... pnpm tsx scripts/make-pool-v2.ts ~/pool-v2 --grade eiken-2 --start 12 --max-usd 2
```

`--count` は級ごとに試す数、`--grade` は級（`,` 区切り）、`--start` は開始番号（テーマの回し始めと id の連番。同じ id のファイルがあれば飛ばす）。ここで出来るのは候補で、絵に描いて（`scripts/scene/render_layout.py`）人が選んでから `src/scenes/pool/` に入れる。

## デプロイ

main に `backend/` の変更が入ると、GitHub Actions（`.github/workflows/deploy-backend.yml`）が自動でデプロイする。手で出すときは `pnpm run deploy`（要 `pnpm exec wrangler login`）。

## 部屋の仕組み

- 部屋ごとに 1 つの Durable Object（`src/durable-objects/room.ts` の `Room`）が、参加者と進行を持つ。部屋のコード（数字 4 桁）を名前にして取り出す。
- コードの置き場所:
  - `routes/`: HTTP の受け口（入力の検証、OpenAPI の説明、レスポンス）
  - `usecases/`: HTTP の処理の中身
  - `repositories/`: 部屋の Durable Object へのアクセス
  - `domain/`: 部屋のルール（参加・スタート・採点の受け付け・締め切り・退出の判定と状態の変化）。Cloudflare に依存しない
  - `durable-objects/`: Durable Object（保存と WebSocket の送受信。判定は `domain/` に任せる）
  - `schemas/`: API の型（zod）
- WebSocket は Hibernation API で受ける。メッセージが無い間は DO が休止してメモリが消えるので、状態は変えるたびに DO の保存領域（SQLite）に書く。
- 誰もつないでいない部屋は 2 時間で消える（DO の alarm）。
- 音声（`POST /rooms/{roomId}/rounds/{round}/audio`）は Worker が受け取り、部屋に「採点中」と記録してから 202 を返す。採点（`score()`）は `waitUntil` で応答の後に続け、終わったら部屋に書き込む。全員の採点がそろうか、締め切りの時刻が来ると、部屋が `results` を配る。締め切りは、録音が終わるはずの時刻（`startAt` ＋ 回転 3 秒 ＋ 録音 20 秒。アプリの `RoundTiming` と同じ値を `src/domain/round.ts` に持つ）から、音声が 15 秒・採点が 30 秒。音声を送っていない人・採点が間に合わなかった人は「採点できませんでした」になり、後から届いた採点は捨てる。音声の締め切りの後に届いた音声と `skip` は `deadline_passed`（音声の口では 409）で断る。時刻は DO の alarm で見る（ホストの交代・部屋の片付けと同じ alarm を、最も早い時刻に予約する）。ホストが締め切る操作（`close`）は無い。
- シーンの選び方（`src/domain/scenes.ts`）:
  - 難易度（`start` の `difficulty`）を受けたら、`src/scenes/pool/index.json` のその難易度の場面から、その部屋でまだ出ていないものをランダムに選ぶ。全部出たら最初に戻る。生成が有効なら、先に部屋が AI で作る（「部屋で AI に作らせる」）。
  - シーン ID を受けたら、そのシーンにする（作り置きの場面の ID だけ。手元で試すとき用）。どちらも無ければ、全部の級の作り置きの場面からおまかせで選ぶ。

## API のスキーマ（OpenAPI）

API の型は zod で書き、[hono-openapi](https://hono.dev/examples/hono-openapi) が OpenAPI を生成する。iOS はリポジトリにある `backend/openapi.json` から型を作る。

- ルートは `src/routes/`、型は `src/schemas/` に置く。`.meta({ ref: "名前" })` を付けた型が、OpenAPI の `components.schemas` に名前付きで出る。
- WebSocket のメッセージは OpenAPI の paths では表せないので、`components.schemas` の `ClientMessage`（iPhone → 部屋）と `ServerMessage`（部屋 → iPhone）に型だけを載せている。どちらも `type` の値で種類を見分ける（`oneOf` ＋ `discriminator`）。
- ルートや型を変えたら `pnpm openapi` で `openapi.json` を生成し直し、一緒に commit する。PR では backend-checks が `pnpm openapi:check` で生成し忘れを検査する。
- `openapi.json` は生成物なので Biome の整形の対象から外している（`biome.json`）。
- `.nullable()` の項目は、iOS の生成器（swift-openapi-generator）が `anyOf` の中の `{ "type": "null" }` を読めないので、出すときに `"type": ["integer", "null"]` などの形へ書き換えている（`src/openapi.ts` の `normalizeNullable`）。

### HTTP の API を足す手順

1. `src/schemas/http.ts` に、リクエストとレスポンスの型を zod で書く。`.meta({ ref: "名前" })` を付ける。

   ```ts
   export const RoomSummary = z
     .object({ roomId: RoomId, playerCount: z.int().min(0) })
     .meta({ ref: "RoomSummary", description: "部屋に入る前の確認用" });
   ```

2. 処理の中身を `src/usecases/` に書く。部屋の Durable Object を使うときは `src/repositories/` を通す。
3. `src/routes/` にルートを書く。`describeRoute` に説明とレスポンスを、`validator` に入力の検証を書く。

   ```ts
   .get(
     "/rooms/:roomId",
     describeRoute({
       operationId: "getRoom", // iOS で生成される関数名になる
       tags: ["rooms"],
       summary: "部屋があるかを確かめる",
       responses: {
         200: { description: "ある", content: jsonContent(RoomSummary) },
         404: { description: "部屋が無い", content: jsonContent(ErrorResponse) },
       },
     }),
     roomIdParam, // validator("param", RoomIdParam, ...)
     async (c) => { /* usecase を呼んで c.json(...) を返す */ },
   )
   ```

4. 新しいファイルにルートを作ったときは、`src/app.ts` の `.route("/", ...)` でつなぐ。
5. `pnpm openapi` で `openapi.json` を作り直し、`pnpm dev` の `/docs` で見え方を確かめる。
6. `pnpm typecheck` を通し、`openapi.json` も一緒に commit する。

### WebSocket のメッセージを足す手順

1. `src/schemas/ws.ts` に、`type` を固定したメッセージの型を書く。

   ```ts
   export const LeaveMessage = z
     .object({ type: z.literal("leave") })
     .meta({ ref: "LeaveMessage", description: "待合から抜ける" });
   ```

2. iPhone → 部屋 なら `ClientMessage`、部屋 → iPhone なら `ServerMessage` の `discriminatedUnion` の配列に足す。
3. **同じところの `discriminator.mapping` にも 1 行足す**（例: `leave: "#/components/schemas/LeaveMessage"`）。足し忘れても型チェックは通るが、iOS で作る型が壊れる。
4. iPhone → 部屋 のメッセージなら、`src/durable-objects/room.ts` の `switch` に処理を足す。判定（してよいか、状態をどう変えるか）は `src/domain/` に書く。
5. `pnpm openapi` で `openapi.json` を作り直して commit する。

## PR ごとのプレビュー

`backend/` を変える PR を出すと、GitHub Actions（`.github/workflows/backend-preview.yml`）がその PR 専用のプレビュー `https://pr-<PR番号>-ng-2622-backend.<サブドメイン>.workers.dev` を作り、URL を PR にコメントする。push のたびに更新され、PR を閉じると消える。iPhone から merge 前の版を試すときはこの URL に向ける。

- 本番とは別の Worker として動き、Durable Objects の保存領域も PR ごとに分かれる。
- `wrangler.jsonc` の上の階層に書いた vars と Durable Objects の binding は引き継がれない。プレビューでも使うものは `previews` の中にも書く。

## secret

API キーはファイルに書かない。

- 本番: `pnpm exec wrangler secret put <名前>`
- プレビュー: `pnpm exec wrangler preview base-config secret put <名前>`（以後に作るプレビューに入る。作成済みのプレビューには `wrangler preview secret put <名前> --name pr-<PR番号>`）
- 手元: `backend/.dev.vars` に `名前=値` で書く（gitignore 済み）

## 型

binding（Durable Objects など）の型 `CloudflareBindings` は、`wrangler types` が `wrangler.jsonc` から `worker-configuration.d.ts` に作る。生成物だが commit しておく（clone してすぐエディタで型が見えるように）。`wrangler.jsonc` や wrangler の版を変えたら `pnpm cf-typegen` で作り直して一緒に commit する。PR では backend-checks が `pnpm cf-typegen:check` で作り直し忘れを検査する。Biome の整形の対象からは外している。
