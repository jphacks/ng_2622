+++
id = "everyone"
title = "みんなの描写"
group = "result"
order = 80
image = "8-everyone.png"
role = "全員の文字起こしを点数順に並べ、同じ場面への解釈の違いを読み比べる。"
main_actions = ["他の人の描写を読む", "戻る"]
data_shown = ["シーンの縮小表示", "参加者ごとの文字起こし・合計点・講評の一言"]
note = "作品の核（解釈の違いを比べる）の場面。1 台だけのときは、事前に録ったチームメンバーの回答と点数をここに並べる。"
entry_points = [
  { from = "ranking", how = "push", trigger = "みんなの描写を見る" },
]
exits = [
  { to = "ranking", how = "戻る", trigger = "戻る" },
]
+++

## 課題

## 改善案

## 決定
