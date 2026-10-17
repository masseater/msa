#!/bin/bash
set -euo pipefail

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

if ! command -v vp >/dev/null 2>&1; then
  curl -fsSL https://vite.plus | VP_NODE_MANAGER=no bash >&2
  echo ". \"$HOME/.config/vite-plus/env\"" >>"$CLAUDE_ENV_FILE"
  . "$HOME/.config/vite-plus/env"
fi

# The same system tools CI installs; the find tool's tests need fd.
if ! command -v fd >/dev/null 2>&1; then
  (apt-get install -y fd-find || (apt-get update && apt-get install -y fd-find)) >&2
  ln -sf "$(command -v fdfind)" /usr/local/bin/fd
fi

cd "$CLAUDE_PROJECT_DIR"
vp env on >&2
vp install --frozen-lockfile >&2
vp run hydrate:model-data >&2
