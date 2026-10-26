#!/usr/bin/env bash
# minimumReleaseAgeExclude の版のうち、レジストリの公開時刻から minimumReleaseAge（分）を過ぎたものを出す。
# 1 行に 1 版、`<パッケージ>@<版>\t<例外の項目>\t<公開時刻>` をタブ区切りで出す。
# 同じ版に当たる例外の項目が複数あれば、1 行にまとめて項目を `, ` でつなぐ。
# 版を書いていない項目（名前やワイルドカード）は、pnpm-lock.yaml に入っている版を見る。
# 公開時刻を取れない版があれば、何も出さずに落とす。取れなかった版を外せないと取り違えないため。
set -euo pipefail

min_age="$(vp pm config get minimumReleaseAge)"
if ! [[ "$min_age" =~ ^[0-9]+$ ]]; then
  echo "::error::minimumReleaseAge が分の数で設定されていない: $min_age" >&2
  exit 1
fi

registry="$(vp pm config get registry)"
registry="${registry%/}"
if ! [[ "$registry" =~ ^https?:// ]]; then
  echo "::error::registry を読めなかった: $registry" >&2
  exit 1
fi
fetch_timeout="${RELEASE_AGE_FETCH_TIMEOUT:-30}"

entries="$(vp pm config get minimumReleaseAgeExclude --json)"
if [ -z "$entries" ] || [ "$entries" = "undefined" ]; then
  entries="null"
fi

locked="$(awk '
  /^[^ #]/ { in_packages = ($0 == "packages:") ; next }
  in_packages && /^  [^ ]/ {
    key = $0
    sub(/^  /, "", key)
    sub(/:$/, "", key)
    gsub(/'\''/, "", key)
    at = index(substr(key, 2), "@") + 1
    if (at > 1) print substr(key, 1, at - 1) "\t" substr(key, at + 1)
  }
' pnpm-lock.yaml 2>/dev/null || true)"

now="$(date -u +%s)"
threshold=$((now - min_age * 60))
candidates="$(mktemp)"
result="$(mktemp)"

jq -r '(. // [])[]' <<<"$entries" | while IFS= read -r entry; do
  [ -n "$entry" ] || continue
  at="$(awk -v e="$entry" 'BEGIN { print index(substr(e, 2), "@") }')"
  if [ "$at" -gt 0 ]; then
    name="${entry:0:$at}"
    for version in $(tr '|' ' ' <<<"${entry:$((at + 1))}"); do
      printf '%s\t%s\t%s\n' "$name" "$version" "$entry"
    done
  else
    pattern="^$(sed -e 's/[][\.^$+?(){}|/]/\\&/g' -e 's/\*/.*/g' <<<"$entry")\$"
    awk -F '\t' -v re="$pattern" -v e="$entry" '$1 ~ re { print $1 "\t" $2 "\t" e }' <<<"$locked"
  fi
done | sort -u >"$candidates"

cut -f1 "$candidates" | sort -u | while IFS= read -r name; do
  [ -n "$name" ] || continue
  if ! times="$(curl -fsS --max-time "$fetch_timeout" --retry 2 --retry-delay 1 \
    -H 'accept: application/json' "$registry/${name/\//%2f}" | jq -c '.time')" ||
    ! jq -e 'type == "object"' >/dev/null 2>&1 <<<"$times"; then
    echo "::error::$name の公開時刻をレジストリから取れなかった" >&2
    exit 1
  fi
  awk -F '\t' -v n="$name" '$1 == n' "$candidates" | while IFS=$'\t' read -r _ version entry; do
    published="$(jq -r --arg v "$version" '.[$v] // empty' <<<"$times")"
    if [ -z "$published" ]; then
      echo "::error::$name@$version の公開時刻がレジストリに無い（例外: ${entry}）" >&2
      exit 1
    fi
    published_at="$(jq -rn --arg t "$published" '$t | sub("\\.[0-9]+Z$"; "Z") | fromdateiso8601')"
    if [ "$published_at" -le "$threshold" ]; then
      printf '%s@%s\t%s\t%s\n' "$name" "$version" "$entry" "$published"
    fi
  done
done >"$result"

sort -t $'\t' -k1,1 -k2,2 "$result" | awk -F '\t' '
  $1 != spec { if (spec != "") print spec "\t" entries "\t" published; spec = $1; entries = $2; published = $3; next }
  { entries = entries ", " $2 }
  END { if (spec != "") print spec "\t" entries "\t" published }
'
