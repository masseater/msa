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

# fd is used by the find tool and its tests (CI installs it the same way); test.sh runs tests under tini as a subreaper.
if ! command -v fd >/dev/null 2>&1 || ! command -v tini >/dev/null 2>&1; then
  apt-get install -y fd-find tini >&2 || { apt-get update >&2 && apt-get install -y fd-find tini >&2; }
fi
command -v fd >/dev/null 2>&1 || ln -sf "$(command -v fdfind)" /usr/local/bin/fd

cd "$CLAUDE_PROJECT_DIR"
vp env on >&2
vp install --frozen-lockfile >&2
