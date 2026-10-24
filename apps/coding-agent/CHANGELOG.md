# Changelog

## [Unreleased]

### Added

- Built-in tools can ask a classifier for a decision with `decide({ name, state, questions })`. The classifier is `decision.model`, by default `local/liquid-d1-3b`, Liquid D1 run in process through `node-llama-cpp`; each question carries its own threshold, which `decision.thresholds` overrides. msa starts fetching the classifier `decision.model` is set to into `<agent dir>/models` and loading it when it starts in interactive or RPC mode, and shows a warning if that fails; until the model is fetched and loaded a decision is `undecided` at once, and the next decision after a failure fetches it again. Offline, no path downloads it: msa uses only a model file already on disk, and decisions stay `undecided` without one ([docs](docs/settings.md))
- A task can carry checks: commands with the exit code, and optionally the output, they must give. `create_task`, `replan`, and `set_task_state` take them. When the worker ends its turn, the harness runs them in the worker's working directory before the reviewer starts and sends failing results back to the worker; after three such rounds in a row the task fails. `orchestrator.db` moves to schema 2, so an older msa stops with "Update msa" instead of running tasks without their checks ([docs](docs/cli.md#tools))
- In a git repository each work task runs in its own worktree and branch, which the harness creates next to the main checkout before the first thread of the task starts; the worker, its reviewer, a rerun, and the goal's checks all use it, and it stays when the thread ends. `create_task` and `replan` take `mergeInto`, another work task that has not started, whose branch this task branches from and merges into instead of opening its own pull request; a task's branch is cut after fetching the default branch from `origin`, and a `replan` task that would inherit a started target is refused; the harness makes that task depend on it, so `create_task` accepts a task with `mergeInto` and no `dependsOn` even when 3 or more tasks are unfinished. `orchestrator.db` moves to schema 3, so an older msa stops with "Update msa" instead of running every task in the main checkout ([docs](docs/cli.md#tools))
- The harness judges each task review with `decide`: when the reviewer ends its turn, the decision model reads the report and the task's goal state and answers whether a finding within the goal remains; it waits up to 10 minutes for the decision model to be fetched and loaded, so reviews are judged in print mode too. `pass` completes the task, `fail` sends the report back to the worker and reviews the fix again, failing the task after three rounds of fixes, and `undecided` (no model, or no answer above the threshold) leaves the task `stopped` instead of `completed` and tells the orchestrator why. The verdict and its reason head the reviewer's report in `/tasks`. Each task report the orchestrator gets starts with the task's result (`completed`, `sent-back`, `waiting`, `stopped`, or `failed`) and carries it as its `status`, so the watchdog's stopped tasks and the recovery notice for tasks back to `waiting` no longer report `failed`. The verdict is stored with the report, so a worker that restarts after the session reopens still gets the findings and the three rounds keep counting; `orchestrator.db` moves to schema 4, so an older msa stops with "Update msa" instead of completing reviewed tasks without a verdict ([docs](docs/cli.md#tools))
- In a repository with an `origin` remote, each work task carries its own pull request, which the harness finds from the task's branch and shows with its number, state, head SHA, CI result, and mergeable state in `list_tasks`, `read_task`, and `/tasks`. When the worker ends its turn, a default goal check sends the work back until that pull request exists, is pushed, does not conflict, is not behind its base, and is green on CI, and counts each of those against the worker's three rounds; while CI is only still running, or no check has registered on a new head yet, the harness waits for it without waking the worker or counting a round, stopping the task after 3 hours, and a pull request whose head has had no check for 2 minutes passes as a repository without CI. When `gh` is missing, not logged in, or finds no GitHub repository at `origin`, the task stops with gh's reason. The reviewer gets the pull request's number and body to check against the final diff. After the review passes, the harness reads the pull request again, merges only when its head, title, and body are the ones that were checked and reviewed, squash-merges it at that head with that title and body as the commit message, and completes the task only once GitHub reports it merged, then removes the task's worktree and branches locally and on `origin`. When CI is running again at that point, the harness waits for it before merging instead of waking the worker; a pull request that cannot merge goes back to the worker instead of completing the task, and after three passing reviews in a row whose pull request could not merge, as when it keeps falling behind its base, the task stops with the reason instead of going back again. When `gh pr merge` fails or the task's run ends mid-merge, the harness reads the pull request again: merged completes the task and cleans up, behind goes back to the worker under the same limit, and anything else stops the task with the reason. Workers and reviewers are told early when they try to merge or turn on auto-merge: on macOS and Linux their shell finds a `gh` wrapper first on `PATH` that refuses `gh pr merge`, the REST and GraphQL merge calls in `gh api` (also from a query file or stdin), and aliases that merge, and the GitHub MCP merge tools are refused; each refusal says why. The wrapper is an early warning, not the guard: a call that gets past it is caught afterwards from the harness's own record. The harness records the head it is about to merge and clears it whenever it reads the pull request as not merged, so a task whose pull request turns out merged at any head the harness did not merge becomes `stopped`, not `completed`, and its report names who merged it and the merge commit; a pull request with auto-merge turned on stops the task at the goal check or before the harness merges, and the report names who turned it on. When `gh pr merge` succeeds but the pull request cannot be read back, the task stops saying the merge was not confirmed, and a rerun completes it once it reads as merged at the recorded head. The worker ends its turn once the pull request is open and pushed; the harness waits for CI. A `replan` that replaces a task hands its open pull request to the new task, which continues on the same branch; a dropped task that still carries an open pull request is named in the replan result, and every report of a task that ends `stopped` or `failed` while carrying an open pull request, whether stopped from `/tasks` or `stop_task`, by the watchdog, by running out of rounds, by CI that never finishes, or by gh being unavailable, names that pull request and its branch. The pull requests live in a new table of `orchestrator.db`, which stays at schema 4, so msa 0.0.5 still opens the same database ([docs](docs/cli.md#tools))

### Changed

- Every session's system prompt has a `development_style` section with msa's own way of working: choose the fix that removes the cause instead of asking the user to pick, fix every place with the same problem and add a guard against it coming back, keep reasons in commit messages, finish verification and cleanup without asking, search for recent facts and existing solutions, write lasting rules into the repository, rebase onto the branch it merges into before pushing, report the resulting state in a few lines with measured numbers and name a decision only when one is needed, and keep names untranslated. `--system-prompt` and `SYSTEM.md` keep it, and the orchestrator's reviewers judge work against it ([docs](docs/how-msa-works.md#context))
- `create_task` rejects a task without dependencies once 3 or more work tasks of the project are waiting or running; the error lists them and says to name a dependency or insert the task with `replan`. With 2 or fewer, `dependsOn` can still be empty. The orchestrator's tool guidelines now ask for strict dependencies: work on the same area, branch, or precondition is chained, parallel only when neither task depends on the other's result, and a red main gets one fixing task that the other work tasks wait for ([docs](docs/cli.md#tools))
- The orchestrator's task reviewer and each round's closing review fail the work on any finding within the task's goal, whatever its severity, and report findings within the goal, problems outside it, and what they checked under separate headings. Such findings are fixed in the same pull request and the work merges only after the review passes; only problems outside the goal become separate issues ([docs](docs/cli.md#tools))

### Fixed

- `msa --help` no longer lists `ANTHROPIC_OAUTH_TOKEN`, which no provider reads; Anthropic takes `ANTHROPIC_AUTH_TOKEN` as a bearer token and `ANTHROPIC_API_KEY` as the API key
- `createAgentSession({ agentDir })` keeps `orchestrator.db`, `memory.db`, and `handoffs/` in that directory even when the settings manager is `SettingsManager.inMemory()` or comes from custom storage; they used to fall back to `MSA_CODING_AGENT_DIR` or `~/.msa/agent`. `AgentSessionConfig` takes the required `agentDir`, and `settingsManager.session.getOrchestratorDatabasePath`, `settingsManager.session.getHandoffDirectory`, and `settingsManager.context.getMemorySettings` take it as an argument
- A task no longer stays `running` after its thread dies. The orchestrator checks its threads every minute and stops the ones with no tool call or message for 30 minutes (60 minutes while one tool call is running), the ones whose last turn ended in an error or abort without finishing, and the ones with no live run; a thread that is compacting is not checked. Their tasks become `stopped` or `failed`, and the session gets a report with the elapsed time. Tasks of another session whose orchestrator process is gone go back to `waiting`, as do a session's own running tasks when it closes or reopens; the reopened session gets a report with how long each had gone without an update. A report for a failed thread now says how long it ran ([docs](docs/cli.md#tools))
- A thread that completes, fails, or is stopped stops every pull request it registered with `pr_watch`, so a CI or review change no longer wakes a finished thread to push or merge
- `pr_watch` no longer reports a check as failed when its run was cancelled because the same check started again on the head, as when editing the pull request restarts its workflow; the orchestrator's pull request check reads CI the same way ([docs](docs/pr-watch.md))
- `/tasks` now lists the tasks of a round that a replan created; rounds missing from an existing database are added when it opens
- A model call that fails with 401, 402, 403, or a provider error naming a rejected key, an empty credit balance, or a spent quota is no longer retried. The session switches to the next model in `enabledModels` whose provider has not failed and resends the request; with none left it stops, writes the time and the error into the transcript, rings the terminal bell with an OSC 9 and OSC 777 notification (wrapped for tmux passthrough inside tmux), shows "(stopped)" in the terminal title, reports program status `blocked` with kind `auth` for a rejected credential or `quota` for a spent balance, and runs the new `notifyCommand` setting with the message in `MSA_NOTIFY_MESSAGE`. Switching the model resumes the run with the reports that arrived meanwhile ([docs](docs/settings.md#network-and-retries))

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
