# Providers

Most hosted providers support one or both of these authentication methods:

- Sign in through a browser or device flow backed by OAuth.
- Provide an API key.

Use `/login [provider]` to see the methods supported by a provider.

## Authenticate interactively

Run `/login` and select a provider. msa guides you through its OAuth or API-key flow and saves the resulting credential in [`auth.json`](configuration.md#agent-directory).

On a remote or headless machine, an OAuth callback may not reach the local process. When prompted, paste the final redirect URL or authorization code back into msa.

Run `/logout` and select a provider to remove its stored credential. This does not unset environment variables, remove authentication from `models.json`, or revoke the credential at the provider.

`auth.json` can contain API keys and OAuth tokens. Keep it private and do not commit it.

## Use an API key from the environment

Environment variables are useful in CI and anywhere msa should not store the key. Set the variable before starting msa:

```bash
export ANTHROPIC_API_KEY=sk-ant-...
msa
```

This table covers providers with a single primary API-key variable. Providers that need additional configuration are covered under [Provider Specific Config](#provider-specific-config).

| Provider            | Environment variable |
| ------------------- | -------------------- |
| Anthropic           | `ANTHROPIC_API_KEY`  |
| OpenAI              | `OPENAI_API_KEY`     |
| OpenRouter          | `OPENROUTER_API_KEY` |
| OpenCode Zen and Go | `OPENCODE_API_KEY`   |
| Radius              | `RADIUS_API_KEY`     |

Anthropic also recognizes `ANTHROPIC_OAUTH_TOKEN` as an API credential and `ANTHROPIC_AUTH_TOKEN` as bearer authentication.

With no key or token set, Anthropic uses workload identity federation when `ANTHROPIC_FEDERATION_RULE_ID`, `ANTHROPIC_ORGANIZATION_ID` and `ANTHROPIC_IDENTITY_TOKEN_FILE` are set: the Anthropic SDK exchanges the identity token for a short-lived access token and refreshes it itself (re-reading the identity token file, so keep that file fresh for long sessions). `ANTHROPIC_SERVICE_ACCOUNT_ID` and `ANTHROPIC_WORKSPACE_ID` are passed through when set.

## Load an API key from a command

To use a secret manager without writing the resolved key to disk, set a provider's `key` in `auth.json` to a command prefixed with `!`:

```json
{
  "anthropic": {
    "type": "api_key",
    "key": "!security find-generic-password -ws 'anthropic'"
  }
}
```

msa runs the command when the key is first needed and caches its standard output for the process lifetime. Empty output, a timeout, or a nonzero exit leaves the key unresolved until msa restarts.

## Provider Specific Config

The providers below have additional setup or need additional settings.

A stored API-key credential can include an `env` object. Its values take priority over the process environment for that provider:

```json
{
  "openrouter": {
    "type": "api_key",
    "key": "sk-or-...",
    "env": {
      "OPENROUTER_TEAM": "my-team"
    }
  }
}
```

### Radius

Radius is a service crafted for msa by the builders of msa, Earendil Works. It provides a customizable AI gateway with organization-level controls and analytics built in, and artifacts for sharing what you create with msa.

To get started, run `/login radius` in msa. This adds Radius as a provider, and its models appear in `/model` like any other provider's.

Radius also has an MCP server, so msa can manage Radius for you.

Radius is currently in early alpha and evolving quickly. See [radius.earendil.com](https://radius.earendil.com) for more.

Radius authentication uses its gateway catalog and caches refreshed model metadata for later offline startup. A custom Radius gateway configured in `models.json` uses its own catalog rather than inheriting the public `radius.pi.dev` catalog.

### OpenRouter

Authenticate with `/login openrouter` or `OPENROUTER_API_KEY`.

With a key, msa lists only the OpenRouter chat models that key may use, with the key's context size, max output, and prices. These come from OpenRouter's `/models/user` endpoint and reflect guardrails and provider restrictions set in OpenRouter. Image and classifier models are not filtered.

msa refreshes the list in the background at startup in interactive mode, when `/model` opens, after `/login`, and on `msa update --models`. The last list is saved and used offline and in `msa -p` and RPC mode. After switching keys outside `/login`, the previous key's list stays until the next refresh.

Regional endpoints filter models to their region. To use one, set the base URL in [`models.json`](models.md#configure-a-compatible-endpoint):

```json
{
  "providers": {
    "openrouter": { "baseUrl": "https://us.openrouter.ai/api/v1" }
  }
}
```

If the base URL rejects the key at `/models/user` or does not have that endpoint, for example a proxy configured as the OpenRouter base URL, msa lists every OpenRouter model.
