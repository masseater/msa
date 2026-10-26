#!/usr/bin/env bash
# minimumReleaseAgeExclude の版のうち、公開から minimumReleaseAge を過ぎたものごとに issue を 1 つ開いておく。
# 新しく過ぎた版は issue を作り、開いている版は issue を更新し、例外から外れた版は issue を閉じる。
set -euo pipefail

label="release-age"
prefix="release-age: "
run_url="$GITHUB_SERVER_URL/$GITHUB_REPOSITORY/actions/runs/$GITHUB_RUN_ID"
expired="$(mktemp)"
body="$(mktemp)"

"$(dirname "$0")/release-age-expired.sh" >"$expired"
min_age="$(vp pm config get minimumReleaseAge)"

gh label create "$label" --color FBCA04 --description "minimumReleaseAgeExclude から外せる版" --force >/dev/null

open_issues="$(gh issue list --label "$label" --state open --limit 500 --json number,title)"

reported_specs="$(cut -f1 "$expired" | sort -u)"

for spec in $reported_specs; do
  entry="$(awk -F '\t' -v s="$spec" '$1 == s { print $2 }' "$expired" | tr ',' '\n' | sed 's/^ *//' | sort -u | paste -sd ',' - | sed 's/,/, /g')"
  published="$(awk -F '\t' -v s="$spec" '$1 == s { print $3; exit }' "$expired")"
  {
    echo "| | |"
    echo "| --- | --- |"
    echo "| 版 | \`$spec\` |"
    echo "| 例外の項目 | \`$entry\` |"
    echo "| 公開時刻 | $published |"
    echo "| minimumReleaseAge | $min_age 分 |"
    echo ""
    echo "公開から minimumReleaseAge を過ぎたので、pnpm-workspace.yaml の minimumReleaseAgeExclude から外せる。"
    echo ""
    echo "最後に出た run: $run_url"
  } >"$body"

  number="$(jq -r --arg title "$prefix$spec" '[.[] | select((.title | split(" ")[0:2] | join(" ")) == $title)][0].number // empty' <<<"$open_issues")"

  if [ -n "$number" ]; then
    gh issue edit "$number" --body-file "$body" </dev/null >/dev/null
    echo "updated #$number for $spec"
  else
    gh issue create --label "$label" --title "$prefix$spec を minimumReleaseAgeExclude から外す" --body-file "$body" </dev/null
  fi
done

jq -r '.[] | "\(.number)\t\(.title)"' <<<"$open_issues" | while IFS=$'\t' read -r number title; do
  [[ "$title" == "$prefix"* ]] || continue
  spec="$(awk '{ print $2 }' <<<"$title")"
  if [ -n "$spec" ] && ! grep -qxF "$spec" <<<"$reported_specs"; then
    gh issue close "$number" --reason completed --comment "minimumReleaseAgeExclude に $spec が無くなった: $run_url" </dev/null >/dev/null
    echo "closed #$number for $spec"
  fi
done

if [ -s "$expired" ]; then
  echo "::error::公開から minimumReleaseAge を過ぎた minimumReleaseAgeExclude の版がある"
  exit 1
fi
