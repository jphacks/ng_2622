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
