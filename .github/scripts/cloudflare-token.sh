#!/usr/bin/env bash
set -euo pipefail
audience="masseater-dev-credential-broker"
oidc="$(curl -fsS -H "Authorization: bearer $ACTIONS_ID_TOKEN_REQUEST_TOKEN" \
  "$ACTIONS_ID_TOKEN_REQUEST_URL&audience=$audience" | jq -er .value)"
echo "::add-mask::$oidc"
response="$(curl -fsS --retry 3 -X POST -H "Authorization: Bearer $oidc" "https://credentials.masseater.dev/")"
token="$(jq -er .token <<<"$response")"
echo "::add-mask::$token"
{
  echo "CLOUDFLARE_API_TOKEN=$token"
  echo "CLOUDFLARE_ACCOUNT_ID=$(jq -er .accountId <<<"$response")"
} >>"$GITHUB_ENV"
