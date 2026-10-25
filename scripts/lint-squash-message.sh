#!/usr/bin/env bash
set -euo pipefail

message="$(node scripts/squash-message.ts print "$1" "$3" "$2")" || {
  printf '%s\n' "$message" >&2
  exit 1
}
printf '%s\n' "$message" | vp exec commitlint --verbose
