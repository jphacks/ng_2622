#!/usr/bin/env bash
# GitHub repo の設定を gh CLI で一括適用する。何度実行しても同じ状態になる。
#   1. .github/labels.yml のラベルを作成・更新する。--prune 指定時は、定義に無いラベルを削除する
#   2. merge 方式を squash のみにし、squash commit の件名を PR タイトルに固定し、
#      merge 後に head branch を自動削除する
#   3. 既定ブランチに ruleset「main-protection」を適用する
#      （PR 必須・1 approve 必須・新しい push で approve を取り消す・pr-checks の pass 必須・
#        merge は squash のみ・linear history・force push と削除の禁止。
#        repo の admin だけは、PR の merge 時に限り approve と pr-checks を待たずに merge できる）
# 使い方: scripts/setup-github-repo.sh [--repo <owner>/<name>] [--prune] [--skip-ruleset] [--dry-run]
#   --repo 省略時はカレントリポジトリの origin を使う。
#   --dry-run は変更内容を表示するだけで実行しない（読み取りは行う）。
#   ruleset の pr-checks は .github/workflows/pr-checks.yml の job 名。workflow が一度も
#   動いていない repo で必須化すると PR が待ち状態のまま merge できなくなるので、先に PR で一度動かす。
set -euo pipefail

REPO=""
DRY_RUN=0
PRUNE=0
SKIP_RULESET=0
RULESET_NAME="main-protection"
# bypass_actors の actor_id 5 は GitHub の組み込みロール「admin」を指す
REQUIRED_CHECK="pr-checks"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --repo) REPO="${2:?--repo には <owner>/<name> が必要です}"; shift 2;;
    --prune) PRUNE=1; shift;;
    --skip-ruleset) SKIP_RULESET=1; shift;;
    --dry-run) DRY_RUN=1; shift;;
    -h|--help) sed -n '2,13p' "$0" | sed -E 's/^# ?//'; exit 0;;
    *) echo "不明な引数: $1" >&2; exit 2;;
  esac
done

command -v gh >/dev/null 2>&1 || { echo "✖ gh CLI が必要です（brew install gh）" >&2; exit 1; }
command -v python3 >/dev/null 2>&1 || { echo "✖ python3 が必要です" >&2; exit 1; }

if [[ -z "$REPO" ]]; then
  REPO="$(gh repo view --json nameWithOwner --jq .nameWithOwner)"
fi
if ! printf '%s\n' "$REPO" | grep -qE '^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$'; then
  echo "✖ --repo は <owner>/<name> 形式で指定してください: $REPO" >&2
  exit 2
fi

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LABELS_FILE="$ROOT/.github/labels.yml"
[[ -f "$LABELS_FILE" ]] || { echo "✖ ${LABELS_FILE} がありません" >&2; exit 1; }

run() {
  if [[ $DRY_RUN -eq 1 ]]; then
    printf 'dry-run: %s\n' "$*"
  else
    "$@"
  fi
}

echo "▶ 対象: $REPO"

# 1. ラベル
echo "▶ ラベルを同期"
labels_tsv="$(python3 - "$LABELS_FILE" <<'PY'
import re, sys
entries, cur = [], None
for raw in open(sys.argv[1], encoding="utf-8"):
    if raw.lstrip().startswith("#"):
        continue
    m = re.match(r'^\s*(-\s+)?(name|color|description):\s*"?(.*?)"?\s*$', raw.rstrip())
    if not m:
        continue
    if m.group(1):
        cur = {}
        entries.append(cur)
    if cur is None:
        sys.exit("labels.yml の形式が不正です（- name から始めてください）")
    cur[m.group(2)] = m.group(3)
for e in entries:
    if not all(k in e for k in ("name", "color", "description")):
        sys.exit(f"name / color / description が揃っていません: {e}")
    print("\t".join((e["name"], e["color"], e["description"])))
PY
)"
while IFS=$'\t' read -r name color desc; do
  run gh label create "$name" --repo "$REPO" --color "$color" --description "$desc" --force
done <<< "$labels_tsv"

if [[ $PRUNE -eq 1 ]]; then
  defined="$(cut -f1 <<< "$labels_tsv")"
  while IFS= read -r existing; do
    [[ -z "$existing" ]] && continue
    if ! grep -qxF "$existing" <<< "$defined"; then
      run gh label delete "$existing" --repo "$REPO" --yes
    fi
  done < <(gh label list --repo "$REPO" --limit 200 --json name --jq '.[].name')
fi

# 2. merge 方式
echo "▶ merge 方式を squash のみに設定"
run gh api -X PATCH "repos/$REPO" --silent \
  -F allow_squash_merge=true -F allow_merge_commit=false -F allow_rebase_merge=false \
  -F delete_branch_on_merge=true \
  -f squash_merge_commit_title=PR_TITLE -f squash_merge_commit_message=PR_BODY

# 3. ruleset
if [[ $SKIP_RULESET -eq 1 ]]; then
  echo "▶ ruleset の適用をスキップ（--skip-ruleset）"
  exit 0
fi
echo "▶ ruleset「${RULESET_NAME}」を既定ブランチに適用"
ruleset_json="$(cat <<JSON
{
  "name": "${RULESET_NAME}",
  "target": "branch",
  "enforcement": "active",
  "bypass_actors": [
    { "actor_id": 5, "actor_type": "RepositoryRole", "bypass_mode": "pull_request" }
  ],
  "conditions": { "ref_name": { "include": ["~DEFAULT_BRANCH"], "exclude": [] } },
  "rules": [
    { "type": "deletion" },
    { "type": "non_fast_forward" },
    { "type": "required_linear_history" },
    { "type": "pull_request", "parameters": {
        "required_approving_review_count": 1,
        "dismiss_stale_reviews_on_push": true,
        "require_code_owner_review": false,
        "require_last_push_approval": false,
        "required_review_thread_resolution": false,
        "allowed_merge_methods": ["squash"]
    } },
    { "type": "required_status_checks", "parameters": {
        "strict_required_status_checks_policy": false,
        "required_status_checks": [ { "context": "${REQUIRED_CHECK}" } ]
    } }
  ]
}
JSON
)"
existing_id="$(gh api "repos/$REPO/rulesets" --jq ".[] | select(.name == \"${RULESET_NAME}\") | .id" | head -n1)"
if [[ $DRY_RUN -eq 1 ]]; then
  printf 'dry-run: %s ruleset (id=%s)\n%s\n' "$([[ -n "$existing_id" ]] && echo 更新 || echo 作成)" "${existing_id:-なし}" "$ruleset_json"
elif [[ -n "$existing_id" ]]; then
  gh api -X PUT "repos/$REPO/rulesets/$existing_id" --input - --silent <<< "$ruleset_json"
else
  gh api -X POST "repos/$REPO/rulesets" --input - --silent <<< "$ruleset_json"
fi
echo "✔ 完了"
