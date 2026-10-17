#!/usr/bin/env bash
# ブランチ名が規約に従うかを検証する。
# 規約: main / <type>/<slug> / <type>/<issue番号>-<slug>（issue 番号は任意）
#   slug は英小文字・数字・ . _ - のみ。許可 type 一覧は scripts/check-commit-msg.sh で定義している。
# 使い方:
#   check-branch-name.sh <branch-name>  指定名を検査（CI はこちら）
#   check-branch-name.sh                pre-push の stdin にある ref、なければ現在の branch を検査
set -euo pipefail

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  sed -n '2,7p' "$0" | sed -E 's/^# ?//'
  exit 0
fi

script_dir="$(cd "$(dirname "$0")" && pwd)"
types="$(bash "$script_dir/check-commit-msg.sh" --types)"

validate_branch() {
  local branch="$1"
  [[ "$branch" == "main" ]] && return 0
  printf '%s\n' "$branch" | grep -qE "^(${types})/[a-z0-9][a-z0-9._-]*$" && return 0
  {
    echo "✖ ブランチ名が規約に反しています: '${branch}'"
    echo "  形式: <type>/<slug> または <type>/<issue番号>-<slug>（英小文字・数字・. _ -）"
    echo "  例:   feat/login-form / fix/12-api-timeout / chore/update-deps"
    echo "  許可 type: ${types//|/, }"
    echo "  名前の変更: git branch -m <新しい名前>"
  } >&2
  return 1
}

if [[ $# -ge 1 ]]; then
  validate_branch "$1"
  exit $?
fi

# pre-push の stdin: "<local ref> <local sha> <remote ref> <remote sha>" を 1 行ずつ受け取る
status=0
checked=0
if [[ ! -t 0 ]]; then
  while read -r local_ref _ remote_ref _; do
    [[ -z "${local_ref:-}" ]] && continue
    # tag や branch 削除（local ref が (delete)）は対象外
    [[ "$remote_ref" == refs/heads/* ]] || continue
    [[ "$local_ref" == "(delete)" ]] && continue
    checked=1
    validate_branch "${remote_ref#refs/heads/}" || status=1
  done
fi
if [[ $checked -eq 0 ]]; then
  current="$(git symbolic-ref --quiet --short HEAD 2>/dev/null || true)"
  [[ -n "$current" ]] && { validate_branch "$current" || status=1; }
fi
exit $status
