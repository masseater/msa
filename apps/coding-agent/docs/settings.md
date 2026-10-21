# Settings Reference

This reference lists user-configurable settings, their types, defaults, and purposes. Project settings override agent-directory settings. Resource lists are combined. See [Configuration](configuration.md) for file locations and trust behavior.

Add `"$schema": "https://raw.githubusercontent.com/masseater/msa/main/apps/coding-agent/schemas/settings.schema.json"` to `settings.json` for editor validation and completion.

## Model and thinking

| Setting                | Type                                                                    | Default                             | Description                                                                                                                                                                                                          |
| ---------------------- | ----------------------------------------------------------------------- | ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `defaultProvider`      | string                                                                  | Automatic                           | Startup AI provider.                                                                                                                                                                                                 |
| `defaultModel`         | string                                                                  | Automatic                           | Startup model ID.                                                                                                                                                                                                    |
| `defaultThinkingLevel` | `"off" \| "minimal" \| "low" \| "medium" \| "high" \| "xhigh" \| "max"` | `"medium"`                          | Startup thinking level.                                                                                                                                                                                              |
| `modelThinkingLevels`  | object                                                                  | None                                | Per-model startup thinking levels keyed by exact `provider/modelId`.                                                                                                                                                 |
| `thinkingBudgets`      | object                                                                  | Built-in budgets                    | Token budgets for `minimal`, `low`, `medium`, and `high` thinking levels.                                                                                                                                            |
| `enabledModels`        | `string[]`                                                              | All available models                | Model patterns used for startup selection and model cycling. Uses the same format as `--models`.                                                                                                                     |
| `modelPolicy`          | `{ allow?: string[], deny?: string[] }`                                 | No restriction                      | Model patterns this session may use. Deny wins, and a non-empty `allow` list leaves only the models it names usable. Uses the same format as `--models`.                                                             |
| `goal.evaluatorModel`  | string                                                                  | Small model of the working provider | Model that judges `/goal` conditions, as `provider/id`. The default is the strongest haiku, flash, mini, lite, or small model of the working model's provider that costs no more than it, or else the working model. |
| `decision.model`       | string                                                                  | `local/liquid-d1-3b`                | Classifier that tools ask for decisions, as `provider/id`. The default runs Liquid D1 in process and downloads it into `<agent dir>/models` on first use; until it is ready, tools act as if no decision was made.   |
| `decision.thresholds`  | object                                                                  | Each tool's own threshold           | Probability a decision must reach before a tool acts on it, keyed by `<decision>.<question>`.                                                                                                                        |
| `hideThinkingBlock`    | boolean                                                                 | `true`                              | Hide thinking blocks in the transcript. Click a hidden block to show it.                                                                                                                                             |
| `showCacheMissNotices` | boolean                                                                 | `false`                             | Show notices for significant cache misses, successful cache warming, compaction usage, and provider recovery.                                                                                                        |
| `cacheWarming`         | `"off" \| "streaming" \| "idle"`                                        | `"streaming"`                       | Keep eligible provider prompt caches warm during active runs or, with `"idle"`, between runs. Global setting only.                                                                                                   |

Cache warming runs only when the model declares a cache lifetime and msa estimates at least $0.05 in avoided cache-miss cost. Refresh usage counts toward session totals but does not enter model context. `/status` shows the next decision; extensions can override it with `cache_warming_decision`. See [Describe model input and caching](models.md#describe-model-input-and-caching).

See [Choose a Model](models.md) for model selection and thinking controls.

### Restrict models

`modelPolicy` decides which models exist for this session. `enabledModels` only narrows what msa offers at startup and on `Ctrl+P`; a model it leaves out is still usable when you name it. `modelPolicy` is the restriction: a hidden model is absent from `--list-models`, `/model`, and `Ctrl+P`, and naming it with `--model` or `/model` fails with the pattern that hides it.

```json
{
  "modelPolicy": {
    "allow": ["anthropic-api/*", "openai/*"],
    "deny": ["openai/gpt-4*", "*:free"]
  }
}
```

Deny patterns win over allow patterns. Agent-directory and project patterns combine, so a project cannot lift a deny pattern set for the machine. Patterns use the `--models` forms: `*`, `provider/*`, an exact `provider/model`, or a glob on the model id. A `*` does not cross `/` in a model id such as `openai/gpt-4` on a gateway; use the exact id there.

`/model` lists hidden models under the `hidden` scope with the pattern that hides each one. `Ctrl+E` denies the selected model or allows it again, and `Ctrl+P` toggles its provider. The `model_policy` tool makes the same changes from the model's side.

## Interaction

| Setting                 | Type                                                                | Default                                     | Description                                                                                                                                                                                                                                                                      |
| ----------------------- | ------------------------------------------------------------------- | ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `steeringMode`          | `"all" \| "one-at-a-time"`                                          | `"one-at-a-time"`                           | How queued steering messages are delivered.                                                                                                                                                                                                                                      |
| `followUpMode`          | `"all" \| "one-at-a-time"`                                          | `"one-at-a-time"`                           | How queued follow-up messages are delivered.                                                                                                                                                                                                                                     |
| `externalEditor`        | string                                                              | `$VISUAL`, `$EDITOR`, then platform default | Command opened by the external-editor keybinding.                                                                                                                                                                                                                                |
| `clipboardImageCommand` | string                                                              | None                                        | Shell command whose stdout is the image the paste keybinding inserts, in place of the local clipboard. Use it when the clipboard is on another machine, such as the one an SSH session comes from. Empty output means no image. **Can only be set in agent-directory settings.** |
| `doubleEscapeAction`    | `"tree" \| "fork" \| "none"`                                        | `"tree"`                                    | Action for double Escape with an empty editor.                                                                                                                                                                                                                                   |
| `treeFilterMode`        | `"default" \| "no-tools" \| "user-only" \| "labeled-only" \| "all"` | `"default"`                                 | Initial filter used by `/rewind`.                                                                                                                                                                                                                                                |
| `defaultProjectTrust`   | `"ask" \| "always" \| "never"`                                      | `"ask"`                                     | Fallback project-trust behavior. **Can only be set in agent-directory settings.**                                                                                                                                                                                                |

## Tools

| Setting                 | Type               | Default                     | Description                                                                                                                                                                                                                                                                                                                                                                   |
| ----------------------- | ------------------ | --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `defaultTools`          | `string[]`         | the built-in defaults below | Tools enabled at startup. Plain names replace the defaults; `+name` adds a tool and `-name` removes one. An empty array disables all built-in tools but not extension or SDK tools.                                                                                                                                                                                           |
| `codemode.mode`         | `"on"` \| `"only"` | `"on"`                      | How the `codemode` tool presents tools while it is active. `on`: declared tools get a note on calling them from scripts appended to their description, and `codemode` lists only tools that are not declared. `only`: `codemode` lists every tool scripts can call, and active built-in and extension tools are hidden from the model, so it reaches them through `codemode`. |
| `codemode.inlineBudget` | number             | `3000`                      | Estimated tokens (characters / 4) the `codemode` tool's description may spend on tool declarations. Tools that do not fit are left out and found with `searchTools()`. `0` lists only namespaces.                                                                                                                                                                             |

Available built-in tools are `read`, `bash`, `powershell`, `edit`, `write`, `grep`, `find`, `ls`, `memory`, and `pr_watch`. The default selection is `read`, `bash`, `edit`, `write`, `memory`, `pr_watch`, `model_policy`, `model_upgrade`, and the [orchestrator tools](cli.md#tools); `web_search` and `web_fetch` join it when the `treg` CLI is installed. `defaultTools` can also name `codemode` and `tool_search`, which built-in extensions register inactive, and other extension tools registered inactive.

`model_policy` reads and changes `modelPolicy` from the model's side, and `model_upgrade` lists and applies [model upgrades](models.md#upgrade-models). A plain-name list replaces the default selection, so name them again to keep them. This keeps the file tools and the model tools, and drops the orchestrator tools:

```json
{
  "defaultTools": ["read", "bash", "edit", "write", "model_policy", "model_upgrade"]
}
```

A list of only `+name` and `-name` entries changes the inherited selection instead of replacing it. For example, this enables `codemode` next to the default tools:

```json
{
  "defaultTools": ["+codemode"]
}
```

This replaces `bash` with `powershell` and enables `grep`: `["-bash", "+powershell", "+grep"]`. Project settings apply on top of user settings: a project list with only `+name` and `-name` entries changes the user's selection, and a project list with a plain name replaces it. In one list, plain names form the selection, and `+name` and `-name` then apply in order.

`/reload` enables tools newly added to `defaultTools`. It does not disable tools removed from it or re-enable unchanged tools you turned off. `--tools` with plain names, `--no-tools`, and `--no-builtin-tools` override `defaultTools`, also on reload.

CLI tool options override this setting for one invocation. `--tools` with only `+name` and `-name` entries changes the resolved `defaultTools` selection instead, for example `msa --tools +codemode`. On `/reload`, these entries apply to the reloaded setting too, so a tool removed with `-name` stays removed. See [Command Line](cli.md#tools).

## Sessions and context

| Setting      | Type   | Default                 | Description                                                                                                                                             |
| ------------ | ------ | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `sessionDir` | string | Agent session directory | Session storage directory. Relative paths resolve from the working directory. `MSA_CODING_AGENT_SESSION_DIR` and `--session-dir` override this setting. |

### Compaction

| Setting                       | Type    | Default | Description                                                 |
| ----------------------------- | ------- | ------- | ----------------------------------------------------------- |
| `compaction.enabled`          | boolean | `true`  | Enable automatic compaction.                                |
| `compaction.reserveTokens`    | number  | `16384` | Tokens reserved for the model response.                     |
| `compaction.keepRecentTokens` | number  | `20000` | Recent tokens retained without summarization.               |
| `compaction.modelOverrides`   | object  | None    | Per-model token settings keyed by exact `provider/modelId`. |

Compaction token values must be non-negative safe integers. Each value resolves independently from the matching model override, then the ordinary compaction setting, then the built-in default. Project and user objects merge before model lookup.

See [Compaction Reference](compaction.md) for trigger, summarization, and validation behavior.

### Branch summaries

| Setting                       | Type    | Default | Description                                               |
| ----------------------------- | ------- | ------- | --------------------------------------------------------- |
| `branchSummary.reserveTokens` | number  | `16384` | Tokens reserved when summarizing branch history.          |
| `branchSummary.skipPrompt`    | boolean | `false` | Skip the branch-summary prompt and default to no summary. |

## Memory

| Setting                           | Type    | Default                          | Description                                                                    |
| --------------------------------- | ------- | -------------------------------- | ------------------------------------------------------------------------------ |
| `memory.enabled`                  | boolean | `true`                           | Register the `memory` tool, prompt recall, and `/memory`.                      |
| `memory.database`                 | string  | `<agent dir>/memory.db`          | SQLite file holding memories. Relative paths resolve from the agent directory. |
| `memory.embedding.enabled`        | boolean | `true`                           | Compute embeddings for meaning-based search.                                   |
| `memory.embedding.baseUrl`        | string  | `http://127.0.0.1:11434/v1`      | OpenAI-compatible base URL; `/embeddings` is appended.                         |
| `memory.embedding.model`          | string  | `embeddinggemma-2`               | Embedding model at that endpoint.                                              |
| `memory.embedding.queryPrefix`    | string  | EmbeddingGemma's task prefix     | Prepended to search queries; clear it for models without task prefixes.        |
| `memory.embedding.documentPrefix` | string  | EmbeddingGemma's document prefix | Prepended to memory text before embedding.                                     |
| `memory.embedding.apiKeyEnv`      | string  | None                             | Environment variable holding the API key, for endpoints that need one.         |
| `memory.embedding.timeoutMs`      | number  | `5000`                           | Embedding request timeout in milliseconds.                                     |
| `memory.recall.enabled`           | boolean | `true`                           | Search memory on every user prompt and add matches to the run.                 |
| `memory.recall.limit`             | number  | `5`                              | Maximum memories added to a run.                                               |
| `memory.recall.minScore`          | number  | `0.72`                           | Minimum relevance for a memory to be recalled; tune it with the model.         |

See [Long-Term Memory](memory.md) for scopes, embeddings, and the `/memory` commands.

## Pull request watches

| Setting                         | Type   | Default | Description                                                 |
| ------------------------------- | ------ | ------- | ----------------------------------------------------------- |
| `prWatch.intervalSeconds`       | number | `45`    | Seconds between reads of each watched pull request.         |
| `prWatch.statusIntervalSeconds` | number | `300`   | Seconds without a change before a watch reports its status. |

See [Watch Pull Requests](pr-watch.md) for the `pr_watch` actions and the messages it sends.

## Telemetry

| Setting                  | Type   | Default                                 | Description                                                                         |
| ------------------------ | ------ | --------------------------------------- | ----------------------------------------------------------------------------------- |
| `telemetry.otlpEndpoint` | string | The `msa-grafana-lgtm` podman container | OTLP/HTTP base URL for traces, metrics, and logs. `MSA_OTLP_ENDPOINT` overrides it. |

See [Telemetry](telemetry.md) for what msa sends and how to read it.

## Terminal and display

| Setting                         | Type                                     | Default        | Description                                                                                                                                                                                                                                                                                           |
| ------------------------------- | ---------------------------------------- | -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `theme`                         | string                                   | `"system"`     | Built-in or custom theme name. `system` derives colors from the terminal theme.                                                                                                                                                                                                                       |
| `quietStartup`                  | boolean \| `"header"`                    | `false`        | `true` hides the startup header and loaded-resource listing. `"header"` keeps the header (version and key hints) but hides the model scope line and loaded-resource listing.                                                                                                                          |
| `tuiMode`                       | `"regular" \| "fullscreen"`              | `"fullscreen"` | Interactive terminal UI mode.                                                                                                                                                                                                                                                                         |
| `fullscreenExitOutput`          | `"transcript" \| "resume-hint"`          | `"transcript"` | Output printed when fullscreen mode exits.                                                                                                                                                                                                                                                            |
| `fullscreenScrollbar`           | `"auto" \| "always" \| "hidden"`         | `"auto"`       | Fullscreen transcript scrollbar behavior.                                                                                                                                                                                                                                                             |
| `fullscreenCopyOnSelect`        | boolean                                  | `true`         | Copy selected text automatically in fullscreen mode.                                                                                                                                                                                                                                                  |
| `fullscreenWheelScrollLines`    | `"auto"` \| number                       | `"auto"`       | Lines per mouse-wheel event in fullscreen mode, from 1 to 100. `"auto"` moves one line per event in local macOS terminals, which already accelerate wheel and trackpad input; elsewhere, and over SSH, it speeds up fast wheel spins to at most 6 lines per event. Alt+wheel moves five times as far. |
| `editorPaddingX`                | number                                   | `0`            | Horizontal editor padding from 0 to 3 cells.                                                                                                                                                                                                                                                          |
| `outputPad`                     | `0 \| 1`                                 | `1`            | Horizontal transcript padding for messages, tool output, `!` command output, and summary blocks.                                                                                                                                                                                                      |
| `autocompleteMaxVisible`        | number                                   | `5`            | Visible autocomplete entries, from 3 to 20.                                                                                                                                                                                                                                                           |
| `showHardwareCursor`            | boolean                                  | `false`        | Use the terminal cursor instead of msa's drawn cursor. msa still positions it for input methods.                                                                                                                                                                                                      |
| `terminal.showImages`           | boolean                                  | `true`         | Display inline images when supported.                                                                                                                                                                                                                                                                 |
| `terminal.imageWidthCells`      | number                                   | `60`           | Preferred inline image width in terminal cells.                                                                                                                                                                                                                                                       |
| `terminal.clearOnShrink`        | boolean                                  | `false`        | Clear empty rows when rendered content shrinks.                                                                                                                                                                                                                                                       |
| `terminal.showTerminalProgress` | boolean                                  | `false`        | Show OSC 9;4 progress in the terminal tab.                                                                                                                                                                                                                                                            |
| `terminal.hyperlinks`           | `boolean \| "auto"`                      | `"auto"`       | Override OSC 8 hyperlink detection.                                                                                                                                                                                                                                                                   |
| `terminal.images`               | `"kitty" \| "iterm2" \| "auto" \| false` | `"auto"`       | Override inline-image protocol detection.                                                                                                                                                                                                                                                             |
| `terminal.trueColor`            | `boolean \| "auto"`                      | `"auto"`       | Override true-color detection.                                                                                                                                                                                                                                                                        |
| `images.autoResize`             | boolean                                  | `true`         | Resize images to at most 2000 by 2000 pixels before sending them to a model.                                                                                                                                                                                                                          |
| `images.blockImages`            | boolean                                  | `false`        | Prevent images from being sent to models.                                                                                                                                                                                                                                                             |
| `markdown.codeBlockIndent`      | string                                   | `"  "`         | Prefix used to indent rendered code blocks.                                                                                                                                                                                                                                                           |
| `markdown.mermaid`              | `"off" \| "final" \| "streaming"`        | `"streaming"`  | Mermaid rendering mode.                                                                                                                                                                                                                                                                               |

See [Themes](themes.md) and [Terminal Setup](terminal-setup.md) for format and platform details.

## Network and retries

| Setting                          | Type                                                   | Default             | Description                                                                                                                        |
| -------------------------------- | ------------------------------------------------------ | ------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `transport`                      | `"auto" \| "sse" \| "websocket" \| "websocket-cached"` | `"auto"`            | Preferred transport for AI providers that support multiple transports.                                                             |
| `httpProxy`                      | string                                                 | None                | Proxy URL applied as `HTTP_PROXY` and `HTTPS_PROXY` for msa-managed HTTP clients. **Can only be set in agent-directory settings.** |
| `httpIdleTimeoutMs`              | number                                                 | `300000`            | HTTP header and body idle timeout in milliseconds. Set to `0` to disable.                                                          |
| `websocketConnectTimeoutMs`      | number                                                 | `15000`             | WebSocket connection timeout in milliseconds. Set to `0` to disable.                                                               |
| `retry.enabled`                  | boolean                                                | `true`              | Enable automatic agent-level retry for transient failures.                                                                         |
| `retry.maxRetries`               | number                                                 | `3`                 | Maximum agent-level retry attempts.                                                                                                |
| `retry.baseDelayMs`              | number                                                 | `2000`              | Initial exponential-backoff delay in milliseconds.                                                                                 |
| `retry.maxAgentDelayMs`          | number                                                 | `60000`             | Maximum agent-level retry delay in milliseconds.                                                                                   |
| `retry.provider.timeoutMs`       | number                                                 | `httpIdleTimeoutMs` | Provider request timeout in milliseconds.                                                                                          |
| `retry.provider.maxRetries`      | number                                                 | `0`                 | Provider-level retry attempts.                                                                                                     |
| `retry.provider.maxRetryDelayMs` | number                                                 | `60000`             | Maximum server-requested delay in milliseconds. Set to `0` to disable the limit.                                                   |

Keep `retry.provider.maxRetries` at `0` unless provider-level retries are required. Provider retries can delay msa from handling quota and usage-limit errors itself.

## Shell

| Setting              | Type       | Default          | Description                                                         |
| -------------------- | ---------- | ---------------- | ------------------------------------------------------------------- |
| `shellPath`          | string     | Platform default | Custom shell executable path. Supports a leading `~`.               |
| `shellCommandPrefix` | string     | None             | Prefix prepended to every shell command.                            |
| `npmCommand`         | `string[]` | `npm`            | Command and arguments used for npm package lookup and installation. |

See [Shell aliases](shell-aliases.md) for shell setup and [msa Packages](packages.md) for package-manager behavior.

## Resources

Resource paths in user settings resolve from the agent directory. Paths in project settings resolve from the project `.msa` directory. Absolute paths and `~` are supported.

| Setting               | Type       | Default | Description                                                              |
| --------------------- | ---------- | ------- | ------------------------------------------------------------------------ |
| `packages`            | array      | `[]`    | npm, git, or local msa package sources. See [msa Packages](packages.md). |
| `extensions`          | `string[]` | `[]`    | Extension files or directories.                                          |
| `skills`              | `string[]` | `[]`    | Skill files or directories.                                              |
| `prompts`             | `string[]` | `[]`    | Prompt-template files or directories.                                    |
| `themes`              | `string[]` | `[]`    | Theme files or directories.                                              |
| `enableSkillCommands` | boolean    | `true`  | Register skills as `/name` commands.                                     |

Resource arrays support glob exclusions with `!pattern`, exact inclusion with `+path`, and exact exclusion with `-path`. msa loads resources listed in both user-level and project settings.

The built-in extensions are named `builtin:mcp`, `builtin:llama.cpp`, `builtin:codemode`, and `builtin:tool-search` in `extensions`. They load by default; `-builtin:mcp` disables one. A `+builtin:<name>` or `-builtin:<name>` entry in project settings overrides the user setting. `msa config` lists them under Built-in. `--no-extensions` disables them too, and `-e builtin:<name>` loads one explicitly.

## Updates and telemetry

| Setting                  | Type    | Default | Description                                                                                |
| ------------------------ | ------- | ------- | ------------------------------------------------------------------------------------------ |
| `collapseChangelog`      | boolean | `false` | Show a condensed changelog after an update.                                                |
| `enableInstallTelemetry` | boolean | `true`  | Send attribution headers to OpenRouter. Does not control update checks.                    |
| `enableAnalytics`        | boolean | `false` | Opt in to analytics data sharing. Currently used only by the experimental first-run setup. |
