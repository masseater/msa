#!/usr/bin/env bash
# 土台のテンプレートの最新の ci-telemetry.sh と、このリポジトリのものを比べる。
# 違えば落とし、定期実行では issue を 1 つ開いておく。揃えば開いている issue を閉じる。
set -euo pipefail

script=".github/scripts/ci-telemetry.sh"
label="template-drift"
title="template-drift: $script differs from the template"

if [ -z "${TEMPLATE_REPOSITORY:-}" ]; then
  echo "::error::repository variable TEMPLATE_REPOSITORY is not set"
  exit 1
fi
echo "::add-mask::$TEMPLATE_REPOSITORY"

latest="$(mktemp)"
gh api -H "Accept: application/vnd.github.raw" "repos/$TEMPLATE_REPOSITORY/contents/$script" >"$latest"

diff_output="$(diff -u --label "msa/$script" --label "template/$script" "$script" "$latest" || true)"

if [ "${GITHUB_EVENT_NAME:-}" = pull_request ]; then
  number=""
else
  number="$(gh issue list --label "$label" --state open --limit 100 --json number,title |
    jq -r --arg title "$title" '[.[] | select(.title == $title)][0].number // empty')"
fi

if [ -z "$diff_output" ]; then
  echo "$script matches the template"
  if [ -n "$number" ]; then
    gh issue close "$number" --reason completed \
      --comment "$script matches the template: $GITHUB_SERVER_URL/$GITHUB_REPOSITORY/actions/runs/$GITHUB_RUN_ID" >/dev/null
    echo "closed #$number"
  fi
  exit 0
fi

printf '%s\n' "$diff_output"
echo "::error file=$script::$script differs from the template. Copy the template's script and update SCRIPT_SHA256 in tools/checks/ci-telemetry-job.test.ts"

if [ "${GITHUB_EVENT_NAME:-}" != pull_request ]; then
  body="$(mktemp)"
  {
    echo "テンプレートの $script が更新され、このリポジトリのものと違う。"
    echo "テンプレートの中身を写し、tools/checks/ci-telemetry-job.test.ts の SCRIPT_SHA256 を新しい値にする。"
    echo
    echo '```diff'
    printf '%s\n' "$diff_output"
    echo '```'
    echo
    echo "最後に見つけた run: $GITHUB_SERVER_URL/$GITHUB_REPOSITORY/actions/runs/$GITHUB_RUN_ID"
  } >"$body"
  gh label create "$label" --color FBCA04 --description "テンプレートとの差" --force >/dev/null
  if [ -n "$number" ]; then
    gh issue edit "$number" --body-file "$body" >/dev/null
    echo "updated #$number"
  else
    gh issue create --label "$label" --title "$title" --body-file "$body"
  fi
fi

exit 1
