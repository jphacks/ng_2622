+++
id = "waiting"
title = "待機"
group = "play"
order = 60
image = "5-waiting.png"
role = "話し終えた人が、他の人の録音と採点が終わるのを待つ。点数は発表まで伏せる。"
main_actions = ["他の人の進み具合を見る", "（ホスト）「締め切って発表する」"]
data_shown = ["残り人数", "参加者ごとの状態（話している / 採点中 / 完了 / 切断中）"]
note = "ThatsFight の WaitingScreen を参考にした。採点が遅れた・失敗した人は「採点できませんでした」として扱う（推測）。"
entry_points = [
  { from = "play-recording", how = "自動", trigger = "話し終えた / 20 秒たった" },
]
exits = [
  { to = "ranking", how = "全員同時", trigger = "全員の採点がそろう / ホストが締め切る" },
]
+++

## 課題

## 改善案

## 決定
