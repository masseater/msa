#!/usr/bin/env bash
# 依存の audit を流し、出た advisory ごとに issue を 1 つ開いておく。
# 新しい advisory は issue を作り、開いている advisory は issue を更新し、出なくなった advisory は issue を閉じる。
set -euo pipefail

label="audit"
run_url="$GITHUB_SERVER_URL/$GITHUB_REPOSITORY/actions/runs/$GITHUB_RUN_ID"
report="$(mktemp)"
body="$(mktemp)"

audit_status=0
vp pm audit --json >"$report" || audit_status=$?

if ! jq -e '.advisories | type == "object"' "$report" >/dev/null 2>&1; then
  echo "::error::vp pm audit が audit の結果を出さなかった (exit $audit_status)"
  cat "$report"
  exit 1
fi

ghsa='^GHSA(-[0-9a-z]{4}){3}$'

unmatched="$(jq -r --arg re "$ghsa" '
  .advisories[]
  | select(((.github_advisory_id // "") | test($re) | not) or ((.module_name // "") == ""))
  | "::error::issue と突き合わせる ID かパッケージ名が無い advisory: "
    + "package=\(.module_name // "-") "
    + "versions=\([(.findings // [])[].version // empty] | unique | join(",") | if . == "" then "-" end) "
    + "fields=\(del(.findings) | with_entries(select(.value != null and .value != "")) | tojson)"
  | gsub("%"; "%25") | gsub("\r"; "%0D") | gsub("\n"; "%0A")
' "$report")"
if [ -n "$unmatched" ]; then
  echo "$unmatched"
  exit 1
fi

gh label create "$label" --color B60205 --description "vp pm audit が出した advisory" --force >/dev/null

open_issues="$(gh issue list --label "$label" --state open --limit 500 --json number,title)"
reported_ids="$(jq -r '.advisories[].github_advisory_id' "$report" | sort -u)"

for id in $reported_ids; do
  jq -r --arg id "$id" --arg run "$run_url" '
    [.advisories[] | select(.github_advisory_id == $id)] as $entries
    | $entries[0] as $a
    | "| | |",
      "| --- | --- |",
      "| Advisory | [\($id)](\(($a.url // "") | if . == "" then "https://github.com/advisories/\($id)" end)) |",
      "| パッケージ | `\($a.module_name)` |",
      "| 入っている版 | \([$entries[] | (.findings // [])[].version // empty] | unique | map("`\(.)`") | join(", ") | if . == "" then "不明" end) |",
      "| 影響する版 | \(($a.vulnerable_versions // "") | if . == "" then "不明" else "`\(.)`" end) |",
      "| 修正版 | \(if ($a.patched_versions // "") == "" or $a.patched_versions == "<0.0.0" then "まだ無い" else "`\($a.patched_versions)`" end) |",
      "| 深刻度 | \($a.severity // "不明") |",
      "",
      ($a.title // ""),
      "",
      "最後に出た run: \($run)"
  ' "$report" >"$body"

  package="$(jq -r --arg id "$id" '[.advisories[] | select(.github_advisory_id == $id)][0].module_name' "$report")"
  number="$(jq -r --arg id "$id" '[.[] | select([.title | scan("GHSA(?:-[0-9a-z]{4}){3}")][0] == $id)][0].number // empty' <<<"$open_issues")"

  if [ -n "$number" ]; then
    gh issue edit "$number" --body-file "$body" >/dev/null
    echo "updated #$number for $id"
  else
    gh issue create --label "$label" --title "audit: $id in $package" --body-file "$body"
  fi
done

jq -r '.[] | "\(.number)\t\(.title)"' <<<"$open_issues" | while IFS=$'\t' read -r number title; do
  id="$(grep -oE 'GHSA(-[0-9a-z]{4}){3}' <<<"$title" | head -n1 || true)"
  if [ -n "$id" ] && ! grep -qxF "$id" <<<"$reported_ids"; then
    gh issue close "$number" --reason completed --comment "vp pm audit で $id が出なくなった: $run_url" >/dev/null
    echo "closed #$number for $id"
  fi
done

exit "$audit_status"
