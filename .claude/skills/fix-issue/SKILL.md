---
name: fix-issue
description: 'Use when starting work on a GitHub issue (e.g. "issue #12 をやって", "#12 に着手") - walks the team flow in order without skipping steps: read the issue, duplicate check, branch from origin/main with a valid name, implement with tests, commit via git-commit skill, open a PR that passes pr-checks and request review.'
arguments: [issue]
argument-hint: "[issue-number]"
---

# Fix Issue

issue から作業を始めるときの手順書。AGENTS.md「開発フロー」の手順を、
抜かさず順番どおりに踏むために使う。規約の中身は AGENTS.md に書き、ここへは複製しない。

## 手順

1. issue を読む: `gh issue view <番号>` で本文・ラベル・コメントを読む。
   issue 本文が scope の境界。
2. 重複確認: `gh pr list --state all --search "<キーワード>"` で、同じテーマが
   他メンバーにより実装中・merge 済みでないかを確認する。進行中なら着手せず報告して止まる。
3. 曖昧さ判定: 前提の曖昧さが大きければ `grill-me`（仕様文書があるなら
   `grill-spec`）で認識を揃え、結論を issue 本文へ書き戻してから続行する。
4. branch 作成: `git fetch origin && git switch -c <type>/<issue番号>-<slug> origin/main`
   （命名規約は `scripts/check-branch-name.sh` で定義している。issue 番号は任意だが、あるなら付ける）。
5. 実装＋テスト: issue の完了条件を満たす変更とテストを書く。
   `scripts/` を変更したら `bash tests/run-tests.sh`。
6. commit: `git-commit` skill で message を生成し、ファイル経由（`-F`）で commit する。
7. PR: `gh pr create`（タイトルは Conventional Commits、body はファイル経由で
   `Closes #<番号>` を含める）。pr-checks が通ることを `gh pr checks` で確認する。
8. review 依頼: main への merge には自分以外 1 人の approve が必要。
   merge は approve 後に PR 作成者が squash merge で行う。

## 途中判断

- scope が issue 本文を超えそうになったら、branch を広げずに issue 分割を提案する。
