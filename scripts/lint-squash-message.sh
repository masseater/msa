#!/usr/bin/env bash
set -euo pipefail

node scripts/squash-message.ts "$1" "$2" | vp exec commitlint --verbose
