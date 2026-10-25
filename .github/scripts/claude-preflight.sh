#!/usr/bin/env bash
set -euo pipefail

if [ -z "${CLAUDE_CODE_OAUTH_TOKEN:-}" ]; then
  echo "::error::The CLAUDE_CODE_OAUTH_TOKEN secret is empty. Store a token from \`claude setup-token\` in it."
  exit 1
fi

if ! command -v claude >/dev/null; then
  curl -fsSL https://claude.ai/install.sh | bash >/dev/null
  PATH="$HOME/.local/bin:$PATH"
fi

workdir="$(mktemp -d)"
output="$(cd "$workdir" && claude -p ok --model claude-haiku-4-5 --max-turns 1 --tools "" \
  --no-session-persistence --output-format json 2>&1)" || true

if ! jq -e 'type == "object" and has("is_error")' <<<"$output" >/dev/null 2>&1; then
  echo "::error::Claude Code did not answer with CLAUDE_CODE_OAUTH_TOKEN: $output"
  exit 1
fi

result="$(jq -r '.result // ""' <<<"$output")"
case "$(jq -r 'if .is_error then .api_error_status // "error" else "ok" end' <<<"$output")" in
  ok)
    echo "CLAUDE_CODE_OAUTH_TOKEN authenticated and the Claude subscription has usage left."
    ;;
  401 | 403)
    echo "::error::Anthropic rejected CLAUDE_CODE_OAUTH_TOKEN: $result"
    exit 1
    ;;
  429)
    echo "::error::CLAUDE_CODE_OAUTH_TOKEN authenticated, but its Claude subscription takes no requests now, so autofix cannot fix this failure: $result"
    exit 1
    ;;
  *)
    echo "::error::Claude Code failed with CLAUDE_CODE_OAUTH_TOKEN: $result"
    exit 1
    ;;
esac
