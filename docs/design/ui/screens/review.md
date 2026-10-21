+++
id = "review"
title = "振り返り"
group = "result"
order = 90
image = "7-review.png"
role = "自分の点数の内訳と、講評・模範表現を見る。"
main_actions = ["点数の内訳を見る", "講評と模範表現を読む", "戻る"]
data_shown = ["合計点", "内容・表現・話し方の点数", "講評の一言（Claude）", "模範表現（英文 1 つ）"]
note = "講評の形は開発しながら決める。遅れたときに削る順番の 4 番目。"
entry_points = [
  { from = "ranking", how = "push", trigger = "自分の結果を振り返る" },
]
exits = [
  { to = "ranking", how = "戻る", trigger = "戻る" },
]
+++

## 課題

## 改善案

## 決定
