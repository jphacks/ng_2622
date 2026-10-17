# 2026/10/17 admin に PR の merge 時だけ ruleset の bypass を認める

## Status
- accepted

## Situation
- main は ruleset `main-protection` で保護し、merge には自分以外 1 人の approve と pr-checks の pass を必須にしている。
- [20261017-adopt-team-git-workflow](./20261017-adopt-team-git-workflow.md) では、admin も bypass できないことにしていた。

## Context
- ruleset を有効にした直後、Discord 通知を追加する PR が、他のメンバーの approve 待ちで merge できなくなった。
- ハッカソンでは、メンバーがすぐにレビューできない時間帯や、提出直前に急いで直したい場面がある。そのときに merge できる手段が無いと、開発が止まる。

## Material for decision
- GitHub の repository rulesets の bypass list（bypass_mode の `pull_request` と `always` の違い）
- Discord 通知の PR（#2）が approve 待ちで止まった経験

## Decision
- ruleset の bypass list に、repo の admin ロールを `bypass_mode: pull_request` で加える。admin は PR を merge するときに限り、approve と pr-checks を待たずに merge できる。
- main への直接 push、force push、削除は admin にも認めない（`always` にはしない）。変更は必ず PR を通る。
- bypass は急ぎの場合の逃げ道とし、普段の PR は通常どおり approve を受けてから merge する。

## Consequences
- メンバーがレビューできないときでも、admin が merge して開発を進められる。
- bypass して merge した PR は、レビューを受けないまま main に入る。誰が bypass したかは PR の画面に残る。
- 変更はすべて PR を通るので、main の履歴が 1 PR = 1 commit であることは保たれる。
