# Changelog

## [Unreleased]

## [0.0.4] - 2026-10-18

### Added

- `/sessions` can start a session and give it instructions
- OpenRouter requests send `provider.data_collection: "deny"` by default; set `compat.openRouterRouting.data_collection` to `"allow"` on a model to opt in ([docs](docs/providers.md#openrouter))

### Removed

- Built-in providers other than OpenRouter, Anthropic, OpenAI, and opencode, along with the API implementations only they used (Mistral Conversations, Azure OpenAI Responses, Google Vertex, Bedrock Converse, and the Radius protocol). Add any of them back as a compatible endpoint in `models.json` ([docs](docs/models.md#configure-a-compatible-endpoint))

## [0.0.3] - 2026-10-17

v0.0.2 was never tagged, so this is the first release after 0.0.1 and also carries the 0.0.2 fixes below.

### Added

- Long-term memory: the `memory` tool, prompt recall, and the `/memory` view keep durable facts across sessions in a local SQLite store, with embeddings from an OpenAI-compatible endpoint (local Ollama with EmbeddingGemma 2 by default, task prefixes included) and keyword search (FTS5 with `Intl.Segmenter`, merged by RRF) as the fallback ([docs](docs/memory.md))
- `/goal` keeps running across turns until a completion condition is met
- An orchestrator that starts and instructs sessions, backed by Neo4j, and the `/sessions` view to watch and steer them
- `/accounts` manages several Claude accounts
- `web_search` and `web_fetch` tools that search and read the web through treg
- `/login` signs in to external services (treg, Claude Code)
- `claude-code` and `opencode-free` are built-in providers
- `clipboardImageCommand` setting to paste clipboard images from another machine
- Tool output and thinking fold to one or two lines and open on click; consecutive tool calls, and thinking in assistant messages with text, fold into one summary line
- Release formulas are published to the `masseater/tap` Homebrew tap (`brew install masseater/tap/msa`)

### Changed

- Built-in commands follow Claude Code's names and order

### Removed

- The `github-copilot` provider
- The subscription-auth extra usage warning and the `warnings` setting

### Fixed

- Closing a credential prompt with Esc is no longer reported as a failed login
- Per-credential `filterModels` no longer drops after a late model update

## [0.0.2] - 2026-10-17

### Fixed

- `msa update` and the startup update notice read the latest version from [msa's GitHub Releases](https://github.com/masseater/msa/releases) instead of pi's, and the changelog link and binary download hint point there too
- msa no longer reports installs to pi.dev or offers the pi.dev installer, which installs pi

## [0.0.1] - 2026-10-16

Forked from pi at [`4a5d372`](https://github.com/earendil-works/pi/tree/4a5d37291531ad48b8e536c892557877d219463c), after pi 1.2.0. Changes up to the fork are in [pi's changelog](https://github.com/earendil-works/pi/blob/4a5d37291531ad48b8e536c892557877d219463c/packages/coding-agent/CHANGELOG.md).
