# 3D シーン

アプリに出す 3D シーン（ジオラマ）。仕様は [`docs/design/scene-generation.md`](../../docs/design/scene-generation.md)。

| 公園 | 教室 | 駅前 |
| --- | --- | --- |
| ![公園](./park.png) | ![教室](./classroom.png) | ![駅前](./station.png) |

## ファイル

シーンごとに 3 つのファイルがある（`<id>` は `park` / `classroom` / `station`）。

| パス | 中身 |
| --- | --- |
| `<id>.usdz` | アプリ用の 3D モデル（1〜2 MB 程度） |
| `<id>.json` | 場面の説明（英語）と、描写してほしい要素 |
| `<id>.png` | 発表用の画像（Cycles でレンダリング） |

`.usdz` と `.png` は `scripts/scene/<id>.py` が生成する。手で編集するのは `.json` だけ。

バックエンドはこの `.json` を読まず、採点には [`backend/src/scoring/scenes.json`](../../backend/src/scoring/scenes.json) を使う（おまかせで選ぶシーンもこの一覧から選ぶ）。シーンを足す・変えるときは、そちらも同じ `id` で直す。

## 座標

RealityKit の座標に合わせてある。

- Y が上、単位はメートル。どのシーンも約 8 m 四方で、地面（床）が y = 0、土台は下にある。
- 正面（画面の手前）は +Z。アプリでは全体を縮小して表示する（例: `entity.scale = [0.05, 0.05, 0.05]`）。
- 部品は名前付きの Xform に分けてある。`entity.findEntity(named: "dog")` のように取り出せる。
  - 公園: `island` `path` `pond` `tree_big` `tree_cherry` `bench` `lamp` `fence` `dog` `boy` `ball` など
  - 教室: `room` `blackboard` `clock` `windows` `teacher_desk` `desk_1`〜`desk_9` `teacher` `student_*` など
  - 駅前: `ground` `road` `station_building` `plaza_clock` `bus_stop` `taxi` `vending_machine` `traveler` `commuter` など
- 街灯や窓、自動販売機は自己発光（emissive）のマテリアル。

## RealityKit での読み込み例

```swift
let scene = try await Entity(named: "park")  // park.usdz をアプリのバンドルに入れておく
scene.scale = [0.05, 0.05, 0.05]
```

## 作り直す

形や色を変えるときは `scripts/scene/<id>.py` を編集して、Blender 4.5 LTS で実行する（画像のレンダリングを含めて 1 シーン 2〜3 分）。共通の道具（形を作る仕組み、人物、書き出し、画像の光とカメラ）は `scripts/scene/common.py` にある。

```sh
blender --background --factory-startup --python scripts/scene/park.py
blender --background --factory-startup --python scripts/scene/classroom.py
blender --background --factory-startup --python scripts/scene/station.py
blender --background --factory-startup --python scripts/scene/park.py -- --no-render   # USDZ だけ
```

Windows で `blender` に PATH が通っていなければ `"C:\Program Files\Blender Foundation\Blender 4.5\blender.exe"` で呼ぶ。
