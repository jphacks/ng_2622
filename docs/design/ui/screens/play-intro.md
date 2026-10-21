+++
id = "play-intro"
title = "プレイ（回転中）"
group = "play"
order = 40
image = "4a-play-intro.png"
role = "全員の端末に同じ 3D シーンを出し、自動で 1 周（約 3 秒）回す。回っている間は操作できない。"
main_actions = ["（操作なし）シーンを見る"]
data_shown = ["3D シーン（自動で 360 度回転）", "カウントダウン「3, 2, 1」（推測）"]
note = "回る 3 秒をカウントダウンも兼ねる（推測）。"
entry_points = [
  { from = "lobby", how = "全員同時", trigger = "ホストがスタート" },
]
exits = [
  { to = "play-recording", how = "自動", trigger = "1 周し終える" },
]
+++

## 課題

## 改善案

## 決定
