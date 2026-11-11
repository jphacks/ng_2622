# 2026/11/10 場面の形を scenenglish.scene/2 にし、要素をチェックリストに置き換え、説明文を見本の答えにする

## Status
- accepted

## Situation
- 場面は配置の JSON（`scenenglish.scene/1`）で表している（[20261024-compose-scenes-from-stored-parts](./20261024-compose-scenes-from-stored-parts.md)）。上の階層は `protocol`・`id`・`name`・`difficulty`・`description`・`elements`・`extraMax`・`items`。
- `description` は、アプリが録音を待つ画面に正答例として出し、採点が補足として Claude に渡している。`elements`・`extraMax` は加点式の名残りで、アプリも今の採点も使っていない。
- 生成で Claude は部品どうしの関係（`place`・`facing`・`motion`）を書くが、保存するときは座標（`position`・`yaw`）に置き換え、関係は残らない。
- アプリは `protocol` が `scenenglish.scene/1` でなければ場面を読まない。
- チェックリストを場面に保存すること、作り置きの JSON に関係を残すこと、難易度の値を `eiken-3`・`eiken-pre2`・`eiken-2` にすることを決めた（PR #100 の ADR 3 本）。

## Context
- チェックリストを入れる欄が要る。`elements` を広げて使うと、配点という古い意味が混ざる。
- 見本の答えと説明文を別々に持つと、出力が増え、2 つが食い違うおそれがある。
- 欄を消し、意味を変え、難易度の値も変えるので、今の形との互換は保てない。

## Material for decision
- grill の決定（2026-11-10、ユーザーとの対話）: 版は `/2`。`description` を見本の答えと一つにする。`elements`・`extraMax` は `checklist` に置き換える。項目は `id`・`kind`・`label`・`accept`・`refs` で、重みは保存しない。`partial` と `cast`（登場する物の呼び名の一覧）は今は省く。2026-11-11 に `cast` は作らないと決めた（下）。
- `cast` を検討した経緯: 英文の部分を先に書くと、`refs` で使う呼び名を部品を置く前に決める必要がある。名詞だけの一覧では動作や文脈が落ちるという指摘があり、動作を含む句にする案も出た。2026-11-11 に生成を 2 段にすると決めたとき、句を検索の問い合わせにすることも考えたが、検索のモデルは「場面の英文 1〜3 文 → 要る要素」で学習していて、句や「名前: 説明」の形では学習と形がずれ、文に隠れた要る物（座る → 椅子）も拾えない。問い合わせは `description` にし、呼び名は `refs` に直接書かせてコードが集めれば足りるので、`cast` は作らないことにした。
- 比べた案:

| 案 | 中身 | 良い点 | だめな点 |
| --- | --- | --- | --- |
| `/2` に上げる（採用） | 壊す変更として版を上げる | 古い形と新しい形が混ざらない | アプリが 2 つの版を読める期間が要る |
| `/1` のまま欄を足す | `checklist` を任意の欄として足す | アプリはそのまま読める | 同じ `/1` でも場面によって中身の意味が違う |

## Decision
- 場面の形を `scenenglish.scene/2` にする。上の階層は `protocol`・`id`・`name`・`difficulty`・`description`・`checklist`・`items`。`elements`・`extraMax` は無くす。
- `difficulty` は `eiken-3`・`eiken-pre2`・`eiken-2`。
- `description` は、級の見本の答え（3・5・6 文）にする。録音を待つ画面の正答例、振り返りの見本、採点の補足に同じ文を使う。チェックリストの `accept` を全部含める。
- `checklist` の 1 項目:

| 欄 | 型 | 意味と使う所 |
| --- | --- | --- |
| `id` | 文字列 | 場面の中で重ならない ID。採点の判定を項目に結びつける。測定で回をまたいで比べる |
| `kind` | `center`・`reason`・`link`・`detail` | 中心・理由・つながり（2級）・細部。重みはコードがここから付ける。裏取りで級の形の数を数える。振り返りのチップに出す |
| `label` | 文字列 | 振り返りに出す日本語 |
| `accept` | 文字列 | 「言えた」とする英語の言い方。採点の Claude が判定の基準にする。一部の判定も、これと比べて採点の Claude が行う |
| `refs` | 文字列の配列 | 項目が指す部品の `key`。裏取りで部品があるか・ポーズが合うかを確かめる。採点で、その部品の情報を Claude に示す。`reason`・`link` は 2 つ以上 |

- 重みは保存しない。後で重みを変えても、場面を作り直さなくてよい。
- `items` の 1 つには、Claude が書いた `place`・`facing`・`motion`（関係）と、プログラムが計算した `position`・`yaw`・`motion`（座標）の両方を残す。関係の動き（`toward`・`path`）と座標の動き（`to`）は、同じ `motion` に並べるか別の欄にするかを実装で決める。
- 生成では、1 回目に英文の部分（`name`・`description`・`checklist`）、2 回目に場面の部分（`items`）を書かせる（[20261110-write-grade-sentences-before-scene-parts](./20261110-write-grade-sentences-before-scene-parts.md)）。`refs` の呼び名は英小文字の短い語にし、2 回目はそれを全部 `key` に使う。
- `partial` と `cast` は持たない。
- アプリは、30 場面を入れ替えるまで `/1` と `/2` の両方を読めるようにし、入れ替えたら `/1` を読む処理を消す。バックエンドも同じ。古い難易度の値は受け付けない（PR #100 の決定）。

## Consequences
- 良い面: 説明文・見本・採点の補足が同じ文になり、食い違いが起きない。
- 良い面: 配点という古い意味の欄が無くなり、場面の形が採点の方式と一致する。
- 良い面: 関係が残るので、裏取りと採点で位置の関係を座標から推し量らなくてよい。
- 良い面: 生成で増える欄は `checklist` の 5 つだけで、今の `elements` とほぼ同じ量。
- トレードオフ: 入れ替えまで、アプリとバックエンドが 2 つの版を読む。
- トレードオフ: `partial` が無いので、「一部」の判定は採点の Claude の判断に任せる。ぶれが大きければ `partial` を足す。
- [20261024-compose-scenes-from-stored-parts](./20261024-compose-scenes-from-stored-parts.md) のうち、配置の JSON に採点の情報として `description`・`elements`・`extraMax` を入れることを置き換える。部品と配置の JSON で場面を作ることは存続する。
