#!/usr/bin/env bash
# scripts/ の検査スクリプトの self-test。`bash tests/run-tests.sh` で実行する（bash 3.2 互換）。
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
pass=0
fail=0

expect() {
  local want="$1" label="$2"
  shift 2
  if "$@" >/dev/null 2>&1; then got=ok; else got=ng; fi
  if [[ "$got" == "$want" ]]; then
    pass=$((pass + 1))
  else
    fail=$((fail + 1))
    echo "FAIL: ${label}（期待 ${want}、実際 ${got}）"
  fi
}

msg="$ROOT/scripts/check-commit-msg.sh"
expect ok "日本語の件名"          bash "$msg" --subject "feat: ログイン画面を追加"
expect ok "英語の件名"            bash "$msg" --subject "fix(api): handle timeout"
expect ok "破壊的変更の !"        bash "$msg" --subject "refactor!: drop old endpoint"
expect ng "type なし"             bash "$msg" --subject "ログイン画面を追加"
expect ng "未知の type"           bash "$msg" --subject "update: README"
expect ng "コロン後の空白なし"    bash "$msg" --subject "feat:add"
expect ng "説明が空"              bash "$msg" --subject "feat: "
expect ng "PR タイトルの Merge"   bash "$msg" --subject "Merge branch 'main'"

tmp="$(mktemp)"
trap 'rm -f "$tmp"' EXIT
printf '# comment\n\ndocs: README を更新\n' > "$tmp"
expect ok "コメント行を飛ばす"    bash "$msg" "$tmp"
printf "Merge branch 'main' into feat/x\n" > "$tmp"
expect ok "ローカルの merge commit" bash "$msg" "$tmp"
printf 'wip\n' > "$tmp"
expect ng "commit の規約違反"     bash "$msg" "$tmp"

br="$ROOT/scripts/check-branch-name.sh"
expect ok "main"                  bash "$br" main
expect ok "type/slug"             bash "$br" feat/login-form
expect ok "type/issue-slug"       bash "$br" fix/12-api-timeout
expect ng "type なし"             bash "$br" login-form
expect ng "大文字"                bash "$br" feat/LoginForm
expect ng "未知の type"           bash "$br" feature/login
expect ok "pre-push stdin（正）"  bash -c "echo 'refs/heads/x 1 refs/heads/feat/ok 0' | bash '$br'"
expect ng "pre-push stdin（誤）"  bash -c "echo 'refs/heads/x 1 refs/heads/Bad 0' | bash '$br'"
expect ok "tag の push は対象外"  bash -c "echo 'refs/tags/v1 1 refs/tags/v1 0' | bash '$br'"

echo "pass=${pass} fail=${fail}"
[[ $fail -eq 0 ]]
