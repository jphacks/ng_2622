# 遊んだ記録（`scenenglish.record/1`）

> Status: **合意済み**（2026-11-12）。決めた理由と比べた案は [ADR](../adr/20261112-keep-play-records-on-device-one-file-per-round.md)。「推測」と書いた箇所と、Open Questions の項目は確認していない。この文書は、記録の形・置き場所・保存するとき・消し方を決める正本。

遊んだ本人が、前のラウンドを場面ごと見返すための記録。本人の苦手の分析の元にもする。端末の中だけに置き、サーバーには送らない。

- 保存・読み出し・消去の層（`PlayRecordStore`）と、ラウンドからの呼び出しは実装した（2026-11-12）。
- 画面（一覧・開き直し・苦手・設定の「すべて消す」）は、まだ無い。次の PR で作る。

## 置き場所

- アプリ用の領域（Application Support）の下の `records/`。
- 1 ラウンドが 2 つのファイル。名前は同じ `id`。

| ファイル | 中身 |
| --- | --- |
| `records/<id>.json` | 記録（下の形） |
| `records/<id>.wav` | そのラウンドの自分の録音（16 kHz・16 bit・モノラル、最長 20 秒で約 0.6 MB）。録れなかったラウンドには無い |

- `id` は記録を作るときに端末が作る乱数（UUID の小文字）。ファイルの名前になるので、英数字と `-` だけにする。
- `records/` は端末のバックアップ（iCloud・Mac）に入れない。アプリを消すと記録も消える（下の Open Questions）。
- 件数と日数の上限は置かない。

## 記録の JSON

例（場面と内訳は一部を省略）:

```json
{
  "protocol": "scenenglish.record/1",
  "id": "8d4d75f1-7763-4067-9eac-9f535cbd64c7",
  "playedAt": "2026-11-11T23:37:06Z",
  "difficulty": "eiken-3",
  "scene": {
    "protocol": "scenenglish.scene/2",
    "id": "gen-v2-eiken3-library-08",
    "name": "図書館の二人",
    "difficulty": "eiken-3",
    "description": "A man is reading a book. A girl is looking at the bookshelf. There is a table next to the bookshelf.",
    "checklist": [{ "id": "man_read", "kind": "center", "label": "男の人が本を読んでいる", "accept": "a man is reading a book", "refs": ["man"] }],
    "items": [{ "key": "ground", "part": "floor_carpet", "place": { "relation": "ground" }, "position": [0, 0, 0] }]
  },
  "result": {
    "transcript": "There are some people here. A girl is looking at. …",
    "score": { "content": 60, "expression": 78, "speech": 80, "total": 70 },
    "content": {
      "claims": [{ "quote": "A girl is looking at.", "verdict": "correct", "item": "girl_look", "level": "partial", "note": null }],
      "items": [{ "id": "girl_look", "kind": "center", "label": "女の子が本棚を見ている", "level": "partial" }],
      "others": 1,
      "recall": { "earned": 2.5, "max": 5 },
      "precision": { "correct": 3, "said": 4 }
    },
    "feedback": {
      "nextStep": { "kind": "content", "text": "次は「男の人が本を読んでいる」を足してみよう。", "item": "man_read", "gain": 6 },
      "rewrite": { "before": "A girl is looking at.", "after": "A girl is looking at the bookshelf.", "reason": "動きをくわしく言うと、場面がもっと伝わります。" },
      "speechTip": { "aspect": "fluency", "text": "文と文の間で止まりすぎないように、続けて言ってみよう。" },
      "expressionBasis": "Uses the present continuous correctly, but one sentence is unfinished."
    }
  }
}
```

### 上の階層

| 項目 | 型 | 意味 |
| --- | --- | --- |
| `protocol` | 文字列 | `scenenglish.record/1` で固定 |
| `id` | 文字列 | 記録の ID。ファイルの名前と同じ |
| `playedAt` | 文字列 | 遊んだ日時（ラウンドの回転が始まった時刻）。ISO 8601、UTC、秒まで |
| `difficulty` | 文字列か null | 級。`eiken-3`・`eiken-pre2`・`eiken-2`。場面の `difficulty` と同じ値で、場面に書かれていなければ null。一覧や分析で場面の中を読まずに済むよう、上にも置く |
| `scene` | オブジェクト | 遊んだ場面の配置の JSON（`scenenglish.scene/2`）をまるごと。形は [`scene-protocol.md`](./scene-protocol.md)。アプリが並べるのに使わない欄（`place`・`refs` など）も、届いたまま残す |
| `result` | オブジェクト | 自分の結果（下） |

- 順位と、ほかの人の結果（名前・色・文字起こし・点）は入れない。自分の表示名も入れない。
- 場面を ID でなく JSON まるごとで持つのは、作り置きの一覧を入れ替えた後や、部屋がその場で作った場面（部屋が閉じると消える）でも、後から同じ 3D と見本の答えを出せるようにするため。

### 自分の結果（`result`）

バックエンドから届いた結果と同じ欄の形で持つ（届いた JSON をそのまま写すのではなく、アプリが読んだ結果から同じ欄の名前で書き直す。アプリが知らない値は、読むときの読み替えのあとの値になる）。`results` の `PlayerResult`（`backend/openapi.json`）から、誰か（`id`・`name`・`color`）と順位（`rank`）を除いたもの。欄の意味は [`usecase.md`](./usecase.md) の「アプリへ送るもの」。

| 項目 | 型 | 意味 |
| --- | --- | --- |
| `transcript` | 文字列 | 文字起こし |
| `score` | オブジェクト | `content`・`expression`・`speech`（各 0〜100）と、重み付きの `total` |
| `content` | オブジェクトか null | 内容の内訳。`claims`・`items`・`others`・`recall`・`precision` |
| `feedback` | オブジェクトか null | 講評。`nextStep`（次の一つ）・`rewrite`（言い直しの例。無ければ null）・`speechTip`（話し方のコツ）・`expressionBasis`（表現の点の根拠。英語 1 文。下） |

- null の欄は、省かずに null と書く（届いた結果と同じ）。
- `feedback.expressionBasis`（2026-11-12 に足した）: 採点の Claude が書いた表現の点の根拠。苦手の分析に使い、振り返りの画面には出さない。版は `/1` のまま足したので、欄が無い前の記録もあり、アプリは無ければ null として読む。書くときは、値が無くても欄を省かずに null と書く。3 語未満で Claude を呼ばなかった回は空の文字列、固定の点数のモードは固定の文になる（届いたまま書く）。
- 種類の値（`verdict`・`level`・`kind`・`aspect`）は、文字のまま書く。アプリは読むときにも文字のまま読み、画面に出すときに読み替える。後から値が増えても、記録ごと読めなくならないようにするため。

## 保存するとき

- ラウンドの結果（`results`）が届き、自分の採点の結果（点）があるときに、1 度だけ保存する。
- 採点に失敗したラウンド（自分が「採点できませんでした」）は残さない。
- 講評だけが届かなかったとき（点はある）は、`feedback` を null にして残す。
- 同じラウンドを 2 回保存しない。`id` はラウンドが始まるときに決め、同じ `id` のファイルがあれば書かない（上書きもしない）。
- 場面の配置の JSON は、3D を出すときに取ったものを使う（ふつうは通信しない）。取れなかったラウンドは残さない（場面の無い記録は作らない）。
- Live でも Mock でも同じ所（`RoomSession`）で保存する。Mock の結果は仮の文と点だが、録音は本物。

## 録音と記録の寿命

- 録音は記録と同じ寿命にする。録音だけが残る状態を作らない。
- 書くときは json → wav の順、消すときは wav → json の順にする。途中で止まっても、残るのは「録音なしの記録」で、記録を消せば録音も消える。
- 録音が無い・写せなかったラウンドは、録音なしの記録として残す。録音があるかは、`<id>.wav` があるかで見る（JSON には書かない）。
- 録音は、ラウンドの一時のファイルを写して作る。元のファイルは今までどおり、次のラウンドか退出で消す。

## 読み出し

- 全部の記録を、新しい順（`playedAt`）で返す。
- 壊れたファイル、知らない `protocol` の記録、ファイルの名前と中の `id` が違う記録は、飛ばして残りを読む。飛ばしたファイルは消さない（新しい版のアプリが書いた記録を、古い版のアプリが消さないため）。
- 記録から、振り返りの画面に渡す形（自分 1 人だけの結果。順位は無い）と、場面の配置（`SceneLayout`）に戻せる。
- 記録の場面から 3D を組み立てる口がある（`SceneLibrary.instance(composing:)`）。ID で取りに行かず、手元の配置から組む。

## 消し方

- 1 つ消す: その記録の `<id>.wav` と `<id>.json` を消す。
- すべて消す: `records/` を、読めなかったファイルも含めてまとめて消す（録音を先に消してから、フォルダを消す）。
- アプリを消すと、記録も録音も消える。
- 設定の画面の「すべて消す」は次の PR で作る。それまでは、アプリを消すと消える。

## 版の上げ方

- 欄を足すだけで、古い記録も新しいアプリで読めるなら、`/1` のまま足す（足した欄は、無くても読めるようにする）。
- 欄の意味を変える・無くす・型を変えるときは、`scenenglish.record/2` に上げる。
  - アプリは、知らない版の記録を読まずに飛ばす。古い版のアプリが新しい記録を壊して読むことは無い。
  - 版を上げるときは、新しいアプリが `/1` も読めるようにするか、`/1` を `/2` に書き直す処理を入れる（記録は端末にしか無いので、読めなくなると本人は取り戻せない）。
- 中に入れる場面の版（`scenenglish.scene/2`）は、記録の版とは別に進む。場面の版が上がったら、アプリは記録の中の古い場面も読めるようにしておく。
- 自分の結果（`result`）の形はバックエンドの `PlayerResult` に合わせている。バックエンドが欄を足したときは、記録にも足すかをここに書く。
  - 2026-11-12: `feedback.expressionBasis` を足した（記録にも足す。`/1` のまま、無くても読める）。

## アプリのコード

| ファイル | 中身 |
| --- | --- |
| `ios/NG2622/Records/PlayRecord.swift` | 記録の型と、結果の画面の形との行き来 |
| `ios/NG2622/Records/PlayRecordStore.swift` | 保存・読み出し・消去（`PlayRecordStore.shared` が `records/`） |
| `ios/NG2622/Records/JSONValue.swift` | 場面をまるごと持つための、形を決めない JSON の値 |
| `ios/NG2622/Game/RoomSession.swift` | 結果が届いたときに保存する |
| `ios/NG2622Tests/PlayRecordStoreTests.swift` | 一時のフォルダで確かめる（本物の領域は触らない） |

## Open Questions

- `records/` を端末のバックアップに入れないままでよいか。入れないのは「端末の中だけ」「アプリを消すと消える」を文字どおりにするため。機種を替えたときに記録を引き継ぎたいなら、バックアップに入れる（プライバシーポリシーも直す）。
- 場面の配置が取れなかったラウンドを、場面なしで残すか。今は残さない。
- 記録が増えたときの読み出し（今は全部のファイルを読む。1 件が数 KB なので、数百件までは困らない見込み。推測）。
