#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Check for --no-env flag
NO_ENV=false
ARGS=()
for arg in "$@"; do
  if [[ "$arg" == "--no-env" ]]; then
    NO_ENV=true
  else
    ARGS+=("$arg")
  fi
done

if [[ "$NO_ENV" == "true" ]]; then
  # Unset API keys (see libs/ai/src/env-api-keys.ts)
  unset ANTHROPIC_API_KEY
  unset ANTHROPIC_OAUTH_TOKEN
  unset OPENAI_API_KEY
  unset OPENROUTER_API_KEY
  unset OPENCODE_API_KEY
  unset GH_TOKEN
  unset GITHUB_TOKEN
  unset HF_TOKEN
  echo "Running without API keys..."
fi

# --import takes a module specifier, so pass the resolver as a file URL (raw paths break on #, ?, %).
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
RESOLVER_URL="$(node -p 'require("node:url").pathToFileURL(process.argv[1]).href' "$REPO_ROOT/apps/coding-agent/src/experimental/source-resolver.ts")"
node --import "$RESOLVER_URL" "$REPO_ROOT/apps/coding-agent/src/cli.ts" ${ARGS[@]+"${ARGS[@]}"}
