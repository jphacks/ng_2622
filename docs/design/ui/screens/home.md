+++
id = "home"
title = "ホーム"
group = "room"
order = 10
image = "1-home.png"
role = "名前を入れて、部屋を作るか、部屋に入るかを選ぶ入口。"
main_actions = ["名前を入力する", "「部屋を作る」でホストになり待合へ", "「部屋に入る」でコード入力へ"]
data_shown = ["前回入力した名前（端末に保存。推測）"]
entry_points = [
  { from = "(起動)", how = "最初の画面", trigger = "アプリを開く" },
  { from = "ranking", how = "戻る", trigger = "退出する" },
]
exits = [
  { to = "lobby", how = "push", trigger = "部屋を作る" },
  { to = "join", how = "push", trigger = "部屋に入る" },
]
+++

## 課題

## 改善案

## 決定
