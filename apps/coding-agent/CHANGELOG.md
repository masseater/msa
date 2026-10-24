# Changelog

## [Unreleased]

### Added

- Built-in tools can ask a classifier for a decision with `decide({ name, state, questions })`. The classifier is `decision.model`, by default `local/liquid-d1-3b`, Liquid D1 run in process through `node-llama-cpp`; each question carries its own threshold, which `decision.thresholds` overrides. msa starts fetching the classifier `decision.model` is set to into `<agent dir>/models` and loading it when it starts in interactive or RPC mode, unless offline, and shows a warning if that fails; until the model is fetched and loaded a decision is `undecided` at once, and the next decision after a failure fetches it again ([docs](docs/settings.md))
- A task can carry checks: commands with the exit code, and optionally the output, they must give. `create_task`, `replan`, and `set_task_state` take them. When the worker ends its turn, the harness runs them in the worker's working directory before the reviewer starts and sends failing results back to the worker; after three such rounds in a row the task fails. `orchestrator.db` moves to schema 2, so an older msa stops with "Update msa" instead of running tasks without their checks ([docs](docs/cli.md#tools))
- In a git repository each work task runs in its own worktree and branch, which the harness creates next to the main checkout before the first thread of the task starts; the worker, its reviewer, a rerun, and the goal's checks all use it, and it stays when the thread ends. `create_task` and `replan` take `mergeInto`, another work task that has not started, whose branch this task branches from and merges into instead of opening its own pull request; a task's branch is cut after fetching the default branch from `origin`, and a `replan` task that would inherit a started target is refused; the harness makes that task depend on it, so `create_task` accepts a task with `mergeInto` and no `dependsOn` even when 3 or more tasks are unfinished. `orchestrator.db` moves to schema 3, so an older msa stops with "Update msa" instead of running every task in the main checkout ([docs](docs/cli.md#tools))

### Changed

- `create_task` rejects a task without dependencies once 3 or more work tasks of the project are waiting or running; the error lists them and says to name a dependency or insert the task with `replan`. With 2 or fewer, `dependsOn` can still be empty. The orchestrator's tool guidelines now ask for strict dependencies: work on the same area, branch, or precondition is chained, parallel only when neither task depends on the other's result, and a red main gets one fixing task that the other work tasks wait for ([docs](docs/cli.md#tools))

### Fixed

- A task no longer stays `running` after its thread dies. The orchestrator checks its threads every minute and stops the ones with no tool call or message for 30 minutes (60 minutes while one tool call is running), the ones whose last turn ended in an error or abort without finishing, and the ones with no live run; a thread that is compacting is not checked. Their tasks become `stopped` or `failed`, and the session gets a report with the elapsed time. Tasks of another session whose orchestrator process is gone go back to `waiting`, as do a session's own running tasks when it closes or reopens; the reopened session gets a report with how long each had gone without an update. A report for a failed thread now says how long it ran ([docs](docs/cli.md#tools))
- A thread that completes, fails, or is stopped stops every pull request it registered with `pr_watch`, so a CI or review change no longer wakes a finished thread to push or merge
- `/tasks` now lists the tasks of a round that a replan created; rounds missing from an existing database are added when it opens

## [0.0.5] - 2026-10-20

### Added

- `/handoff [path]` writes the orchestrator's state to one Markdown file under `<agent dir>/handoffs/` and prints the line to paste into the next session. The tool fills in the tasks, notes, replans, running and waiting threads, and open PRs and issues; the model writes the premise, the goals in dependency order, and what not to start. A fresh interactive session asks once whether to resume from a handoff it has not offered before ([docs](docs/slash-commands.md#hand-over-to-the-next-session))

### Changed

- What the orchestrator runs for a task is a thread, so a session is only a saved conversation: `set_max_concurrent_sessions` is `set_max_concurrent_threads`, `/sessions` is `/threads`, `orchestrator.maxConcurrentSessions` is `orchestrator.maxConcurrentThreads`, `app.orchestrator.sessions` is `app.orchestrator.threads`, and the `msa.session` span, its `msa.session.*` attributes, and `msa_orchestrator_sessions_active` are `msa.thread`, `msa.thread.*`, and `msa_orchestrator_threads_active`. An existing `orchestrator.db` moves its `sessions` table to `threads` on open ([docs](docs/cli.md#tools))

### Fixed

- msa starts again after 0.0.4 opened an `orchestrator.db` that a newer msa had already moved to `threads`: the empty `sessions` table 0.0.4 left behind is merged into `threads` and dropped. `orchestrator.db` now records its schema version, and an msa older than the database stops with "Update msa" instead of changing it

## [0.0.4] - 2026-10-19

### Added

- The orchestrator tools are part of every session's default tools: the session breaks a request into tasks, each declaring its current state, the goal state, and its dependencies, and the scheduler starts tasks whose dependencies are finished within the concurrency limit and puts a separate reviewer session after each worker ([docs](docs/cli.md#tools))
- `set_task_depends` and `set_task_state` change a task's dependencies and its current and goal states before it starts; `/tasks` edits them with `d`, `w`, and `g` ([docs](docs/cli.md#tools))
- `replan` stops the running work at a turn boundary with a wrap-up (commit, push, handoff note), rewrites the DAG in one transaction, and resumes from the handoff ([docs](docs/cli.md#tools))
- `/sessions` starts a session and gives it instructions; a session can also be started after another one with `dependsOn`
- In fullscreen mode the screen splits into the conversation and a sessions pane; `Shift+→` opens `/tasks`, `Shift+←` or `Esc` returns, and dragging the divider or `Ctrl+Shift+←/→` resizes it ([docs](docs/cli.md#tools))
- `modelPolicy` hides models by pattern and keeps them in the picker under `hidden` with the pattern that hides each one; `/model upgrade` and the `model_upgrade` tool move the settings to a newer model ([docs](docs/models.md#restrict-models))
- `pr_watch` follows pull requests and tells the session when checks, reviews, comments, the base branch, or the merge state change; it is enabled by default ([docs](docs/pr-watch.md))
- msa sends traces, metrics, and logs over OpenTelemetry to `MSA_OTLP_ENDPOINT`, `telemetry.otlpEndpoint`, or a local `msa-grafana-lgtm` container it runs with podman; the Grafana URL is shown at startup and in `/status` ([docs](docs/telemetry.md))
- `/status` (`/context`) breaks the next request down into system prompt sections, each tool definition, conversation, tool results by tool, and compaction, with tokens and shares; RPC `get_state` carries it as `contextUsage`
- Pressing Enter three times in a row on an empty input sends every queued steering and follow-up message at the next turn boundary, in the order they were entered ([docs](docs/keybindings.md))
- OpenRouter requests send `provider.data_collection: "deny"` by default; set `compat.openRouterRouting.data_collection` to `"allow"` on a model to opt in ([docs](docs/providers.md#openrouter))
- `/ask <question>` runs a turn in which the model can only answer: only tools marked `readOnlyHint` are declared (`memory`, `pr_watch`, `model_policy`, and `model_upgrade` keep their read actions), the system prompt says to answer without starting work, and the next turn is back to every tool. RPC `prompt` takes `"mode": "ask"` and the SDK `prompt(text, { mode: "ask" })` ([docs](docs/slash-commands.md#ask-a-question))

### Changed

- The `anthropic` provider is now `anthropic-api` and `claude-code` is now `claude-subs`, so the pay-per-token API and Claude subscriptions read apart; credentials, `models.json` and settings move to the new ids on startup
- `claude-subs` and `opencode-free` are part of msa instead of built-in extensions, so `--no-extensions` keeps them; they are listed only when `claude` / `opencode` is installed
- `anthropic-api` takes API keys only: the Claude Pro/Max sign-in, `ANTHROPIC_OAUTH_TOKEN`, and the requests that posed as Claude Code are gone; a stored Claude Pro/Max sign-in is dropped on startup. Use `claude-subs` for a subscription
- `/accounts claude add|remove` rebuilds the `claude-subs-<account>` providers without reloading the session
- `claude-subs` lists versioned model ids only (`claude-opus-5-5`, `claude-sonnet-5-5`, `claude-haiku-5-5`, `claude-fable-5-1`); `opus`, `sonnet`, `haiku`, and `fable` are no longer accepted
- The orchestrator keeps tasks, sessions, reports, and shared notes in SQLite (`orchestrator.database`, default `<agent dir>/orchestrator.db`) instead of Neo4j; existing task prompts move to the current state on startup
- `create_task` and `replan` take `currentState` and `goalState` instead of a free-form prompt, and tasks no longer carry `paths`, `repos`, or `priority`

### Removed

- `--orchestrator`, now the default; passing it is an error
- `undo_replan`; run `replan` again instead
- The `NEO4J_*` environment variables for the orchestrator
- Built-in providers other than `anthropic-api`, OpenRouter, OpenAI, `claude-subs`, and `opencode-free`, along with the API implementations only they used (Mistral Conversations, Azure OpenAI Responses, Google Vertex, Bedrock Converse, and the Radius protocol). Add any of them back as a compatible endpoint in `models.json` ([docs](docs/models.md#configure-a-compatible-endpoint))

### Fixed

- `/tasks` and `/memory` scroll when the list or the details do not fit, with `PageUp`/`PageDown` and `Ctrl+D`/`Ctrl+U`
- Memory recall and search no longer wait on the embedding endpoint while no memory is stored
- OpenRouter and opencode requests report msa rather than pi
- `/effort` completes model ids again

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
