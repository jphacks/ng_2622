+++
id = "ranking"
title = "結果発表"
group = "result"
order = 70
image = "6-ranking.png"
role = "全員の画面に同じ順位表を出し、最下位から 1 行ずつパタパタ表示で開いて、最後に優勝を出す。"
main_actions = ["発表を見る", "「発表をとばす」", "「みんなの描写を見る」", "「自分の結果を振り返る」", "（ホスト）「同じ顔ぶれでもう一度」", "退出する"]
data_shown = ["順位・名前・合計点", "優勝者"]
note = "ThatsFight の RankingScreen を参考にした（約 0.9 秒ごとに 1 行、自分の行に印を付けない）。遅れたときはパタパタ表示を外し、普通の順位表にする。"
entry_points = [
  { from = "waiting", how = "全員同時", trigger = "全員の採点がそろう / ホストが締め切る" },
  { from = "everyone", how = "戻る", trigger = "戻る" },
  { from = "review", how = "戻る", trigger = "戻る" },
]
exits = [
  { to = "everyone", how = "push", trigger = "みんなの描写を見る" },
  { to = "review", how = "push", trigger = "自分の結果を振り返る" },
  { to = "lobby", how = "全員", trigger = "（ホスト）同じ顔ぶれでもう一度" },
  { to = "home", how = "戻る", trigger = "退出する" },
]
+++

## 課題

## 改善案

## 決定
