+++
id = "play-recording"
title = "プレイ（録音中）"
group = "play"
order = 50
image = "4b-play-recording.png"
role = "全員一斉に録音を始め、3D シーンを見ながら英語で描写する。"
main_actions = ["英語で話す", "指で 3D を回して見る（推測）", "「話し終えた」で自分の録音を止める"]
data_shown = ["3D シーン", "録音中の表示と残り時間（最長 20 秒）", "音量メーター"]
note = "ライブ字幕は出さない。字幕を見て言い直すのは現実の会話では起きず、本質的な英語学習にならないため。"
entry_points = [
  { from = "play-intro", how = "自動", trigger = "1 周し終える" },
]
exits = [
  { to = "waiting", how = "自動", trigger = "話し終えた / 20 秒たった" },
]
+++

## 課題

## 改善案

## 決定
