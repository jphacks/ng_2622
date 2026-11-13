# 2026/11/12 merge の前に PR のブランチを最新の main に追従させる

## Status
- accepted

## Situation
- main は ruleset `main-protection` で保護し、merge には 1 approve と pr-checks の pass を必須にしている。
- pr-checks の必須チェックは `strict_required_status_checks_policy: false` で、PR のブランチが古い main のままでも merge できた。

## Context
- PR の CI は、ブランチを切った時点の main の上で通っている。その後に別の PR が main に入っても、CI は再実行されない。
- 2 つの PR が互いに衝突せずに merge できても、組み合わせると壊れることがある（例: 一方が関数名を変え、もう一方が旧名を使う新しいコードを足す）。squash merge は Git の上で衝突しなくても、意味の上で壊れうる。
- 提出前は PR が同時に何本も進むので、main が壊れて気づくのが遅れると影響が大きい。

## Material for decision
- GitHub の ruleset の `strict_required_status_checks_policy`（最新の main を含まない PR の merge を止める設定）
- 代替案: merge queue（merge 直前に main と合成した状態で CI を回す。workflow に `merge_group` の trigger が要る）、今のままにして main の CI で気づく

## Decision
- `strict_required_status_checks_policy` を `true` にする。PR のブランチが最新の main を含まないと merge できない。
- 設定の正本は `scripts/setup-github-repo.sh` とし、実リポジトリへも同じ値を適用する。
- 5 人のチームで PR の本数が限られるので、merge queue は入れない。

## Consequences
- main に別の PR が入ったあと、他の PR は「Update branch」で追従し、pr-checks が再実行されるのを待つ。手間は増えるが、merge 後に main の CI だけが落ちる事故は減る。
- Update branch は push なので、`dismiss_stale_reviews_on_push` により approve が取り消されうる。
- admin の bypass（PR の merge 時のみ）は残るので、急ぎのときは追従を待たずに merge できる。
