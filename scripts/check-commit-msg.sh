#!/usr/bin/env bash
# 件名が Conventional Commits 形式かを検証する（説明部の言語は問わない）。
# 使い方:
#   check-commit-msg.sh <commit-msg-file>     commit-msg フックから（lefthook.yml 参照）
#   check-commit-msg.sh --subject "<text>"    件名文字列を直接検査（CI の PR タイトル検査など）
#   check-commit-msg.sh --types               許可 type の正規表現を出力
# 許可 type 一覧はこのファイルで定義する。macOS(BSD) / Linux 両対応・pure bash。
set -euo pipefail

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  sed -n '2,7p' "$0" | sed -E 's/^# ?//'
  exit 0
fi

types='feat|fix|docs|style|refactor|perf|test|build|ci|chore|revert'

if [[ "${1:-}" == "--types" ]]; then
  printf '%s\n' "$types"
  exit 0
fi

subject=""
from_commit_file=0
if [[ "${1:-}" == "--subject" ]]; then
  subject="${2:?--subject には検査する文字列が必要です}"
else
  from_commit_file=1
  MSG_FILE="${1:?commit-msg ファイルのパスか --subject \"<text>\" が必要です}"
  # 最初の非コメント・非空行を件名として扱う
  subject="$(grep -vE '^[[:space:]]*#' "$MSG_FILE" | grep -vE '^[[:space:]]*$' | head -n1 || true)"
fi

# git が生成する merge / revert / fixup の件名はローカル commit では許可する（squash で消える）。
# PR タイトルが通る --subject 経路には適用しない。
if [[ "$from_commit_file" -eq 1 ]] && printf '%s\n' "$subject" | grep -qE '^(Merge|Revert|fixup!|squash!|amend!) '; then
  exit 0
fi

if ! printf '%s\n' "$subject" | grep -qE "^(${types})(\([a-zA-Z0-9._/-]+\))?!?: [^[:space:]].*"; then
  {
    echo "✖ 件名が Conventional Commits 形式ではありません。"
    echo "  形式: <type>(任意のscope): 説明（日本語・英語どちらでも可）"
    echo "  例:   feat: ログイン画面を追加 / fix(api): handle timeout"
    echo "  許可 type: ${types//|/, }"
    echo "  実際の件名: '${subject}'"
  } >&2
  exit 1
fi
