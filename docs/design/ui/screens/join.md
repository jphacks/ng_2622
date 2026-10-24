+++
id = "join"
title = "部屋に入る"
group = "room"
order = 20
image = "2-join.png"
role = "ホストが見せる部屋のコードを入力するか、QR を読み取って部屋に入る。"
main_actions = ["4 桁の部屋コードを入力する", "「QR を読み取る」でカメラを開く", "「入る」で待合へ"]
data_shown = ["入力中のコード", "コードが違うときのエラー"]
note = "遅れたときに削る順番の 1 番目が QR の読み取り（コード入力だけにする）。"
entry_points = [
  { from = "home", how = "push", trigger = "部屋に入る" },
]
exits = [
  { to = "lobby", how = "push", trigger = "入る / QR を読み取る" },
  { to = "home", how = "戻る", trigger = "戻る" },
]
+++

## 課題

## 改善案

## 決定

- QR の読み取りを作った（2026-10-24）。VisionKit の DataScannerViewController で QR だけを読み、読めたコードは打ったときと同じ流れで確かめる（無い部屋なら「部屋が見つかりません」）。部屋の QR でないものは「ScenEnglish の部屋の QR ではありません」と出して読み続ける。
- QR の中身は `scenenglish://room/<4 桁のコード>`。作る側（待合）と読む側はどちらも `RoomLink`（`ios/NG2622/Room/RoomQRCode.swift`）を使う。
- 「QR を読み取る」は読めない端末（シミュレーターなど）でも出しておき、押したときに理由を出す。画面の形を端末によって変えないため。カメラを断られているときは、設定を開くボタンを出す。
