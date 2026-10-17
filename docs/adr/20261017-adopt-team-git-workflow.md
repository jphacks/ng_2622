# 2026/10/17 PR 必須・squash merge・規約の自動検査によるチーム開発フロー

## Status
- accepted

## Situation
- JPHACKS 2026 に 5 人で参加する。開発期間は数週間の短期決戦。
- 技術スタックは未定。Web アプリを想定し、iOS を使うかは未定。
- メンバーが使う AI エージェントは Claude Code が中心で、他のツールを使う人もいる。

## Context
- 5 人が同時に main へ変更を入れるため、壊れた変更や意図しない上書きを防ぐ仕組みが要る。
- commit や PR の書き方がばらばらだと、履歴から変更を追いにくい。口頭の約束だけでは短期間の開発中に守られなくなる。
- 一方で、手続きが重すぎるとハッカソンの開発速度を落とす。

## Material for decision
- 開発開始時の grill（認識合わせ）での合意内容
- GitHub の repository rulesets と、Actions の required status checks の仕様

## Decision
- main は ruleset `main-protection` で保護する。PR を必須にし、自分以外 1 人の approve と、Actions の `pr-checks` の pass を merge の条件にする。approve 後に push すると approve を取り消す。force push と削除は禁止し、admin も bypass できないようにする。
- merge 方式は squash のみにし、squash commit の件名を PR タイトルに固定する。merge 後の head branch は自動で削除する。
- commit 件名と PR タイトルは Conventional Commits 形式にする。説明部の言語は問わない。PR タイトルは main の履歴に残るので Actions で必ず検査し、個々の commit は lefthook（commit-msg）で手元で検査する。
- ブランチ名は `<type>/<slug>` にする。issue 番号は付けても付けなくてもよい。lefthook（pre-push）と Actions で検査する。
- issue の作成と、PR から issue へのリンクは推奨にとどめ、検査はしない。
- 規約の検査は `scripts/` のシェルスクリプトにまとめ、lefthook と Actions の両方から呼ぶ。Actions では PR 側の変更で検査を通せないよう、base 側のスクリプトで検査する。
- GitHub 側の設定は `scripts/setup-github-repo.sh` で再現できるようにする。
- AI エージェント向けの指示は `AGENTS.md` に書き、`CLAUDE.md` をその symlink にする。共有の skill は `.claude/skills/` に置く。

## Consequences
- main の履歴は 1 PR = 1 commit になり、件名から変更の種類が分かる。
- 自分の PR を自分だけで merge できないので、レビューを待つ時間が発生する。5 人いれば待ち時間は短いと見込んでいる。提出直前に急ぐ場合も例外はない。
- lefthook は各自が `lefthook install` するまで効かない。入れていなくても、PR タイトルとブランチ名は Actions が検査する。
- スタックが決まったら、lint・型検査・テストの job を pr-checks に追加する（job 名を変える場合は ruleset の必須チェック名も合わせる）。
