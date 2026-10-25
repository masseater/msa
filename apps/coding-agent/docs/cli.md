# Command Line

This page documents msa's built-in command-line commands and options. Run `msa --help` or append `--help` to a command for the exact interface in your installed version. The top-level help also includes options registered by loaded extensions.

```sh
msa [options] [--] [@files...] [messages...]
msa install <source> [options]
msa remove <source> [options]
msa uninstall <source> [options]
msa update [target] [options]
msa list
msa config [options]
msa auth <check|print-api-key|print-bearer-token> [options]
msa mcp <list|login|logout> [options]
```

## Invocation and output

```sh
msa
msa --print "Summarize this repository"
git diff | msa --print "Review this change"
msa --mode json "Inspect this repository" > events.jsonl
```

With terminal stdin and stdout, msa opens the terminal UI unless `--print`, `--mode json`, or `--mode rpc` selects another interface. When either stream is redirected and neither JSON nor RPC mode is selected, msa uses print mode. See [CLI Integration](cli-integration.md) for choosing between interactive, print, JSON, RPC, and SDK integration.

| Input       | Behavior                                           |
| ----------- | -------------------------------------------------- |
| `message`   | Provide an initial prompt                          |
| `@path`     | Include a text file or image in the first prompt   |
| Piped stdin | Prepend its contents to the first prompt           |
| `--`        | Stop option parsing so a prompt can begin with `-` |

msa resolves `@path` from the current working directory. The working directory also controls project configuration, resource discovery, and session grouping.

`--print` controls whether msa runs once and exits. `--mode` selects the output interface. `--mode text` does not force one-shot execution when stdin and stdout are terminals; use `--print` for that behavior.

| Option                      | Behavior                                                                                |
| --------------------------- | --------------------------------------------------------------------------------------- |
| `-p`, `--print`             | Run the supplied prompts, write the final assistant text to stdout, then exit           |
| `--mode text`               | Select text output; still open the terminal UI when stdin and stdout are terminals      |
| `--mode json`               | Run the supplied prompts, write JSONL events to stdout, then exit                       |
| `--mode rpc`                | Read JSONL commands from stdin and write responses and events to stdout until shutdown  |
| `--export <input> [output]` | Export a session file to HTML and exit; derive the destination when `output` is omitted |

RPC mode rejects `@file` arguments. JSON and RPC modes reserve stdout for protocol records. See [JSON Event Stream](json.md) and [RPC Protocol](rpc.md).

## Models

```sh
msa --model claude-subs/claude-sonnet-5-5:high
```

See [Choose a Model](models.md) for model selection and [Providers](providers.md) for credentials.

- `--provider <name>`<br>
  Restricts `--model` lookup to one provider. It requires `--model`.
- `--model <pattern>`<br>
  Selects by exact ID or fuzzy ID/name match. It accepts `provider/id` and an optional `:<thinking>` suffix. If several providers match, msa prefers the one with credentials, otherwise it asks for `--provider`.
- `--api-key <key>`<br>
  Uses a non-persistent API-key override. It requires a model selected through `--model` or `--models`. It does not choose between providers that offer the same model.
- `--thinking <level>`<br>
  Sets `off`, `minimal`, `low`, `medium`, `high`, `xhigh`, or `max`. It overrides a `--model` suffix and is clamped to the model's capabilities.
- `--models <patterns>`<br>
  Sets a comma-separated scope for startup and cycling. It accepts exact IDs, fuzzy matches, case-insensitive globs, and optional `:<thinking>` suffixes. A model offered by several providers is added for each, with a warning.
- `--list-models [search]`<br>
  Lists available models, optionally filtered by a fuzzy search, then exits. Models hidden by [`modelPolicy`](settings.md#restrict-models) are left out, with a count and the patterns that hide them.

## Sessions

```sh
msa --continue
```

See [Sessions and Context](sessions.md) for resuming, forking, naming, and storing sessions.

- `-c`, `--continue`<br>
  Continues the most recent session for the current project.
- `-r`, `--resume`<br>
  Opens the session selector.
- `--session <path|id>`<br>
  Opens by file path, exact ID, or partial ID. msa searches the current project first and offers to fork a cross-project match.
- `--session-id <id>`<br>
  Opens the exact project session ID or creates it if absent. IDs accept letters, numbers, `.`, `_`, and `-`.
- `--fork <path|id>`<br>
  Forks an existing session into a new session for the current project.
- `--session-dir <dir>`<br>
  Overrides storage and lookup. It takes precedence over `MSA_CODING_AGENT_SESSION_DIR` and the `sessionDir` setting.
- `--no-session`<br>
  Uses an in-memory session that is not persisted.
- `-n`, `--name <name>`<br>
  Sets the session display name.

Constraints:

- Session IDs must start and end with a letter or number.
- `--fork` cannot be combined with `--session`, `--continue`, `--resume`, or `--no-session`.
- `--session-id` cannot be combined with `--session`, `--continue`, or `--resume`. Combine it with `--fork` to choose the new ID.

## Tools

```sh
msa --tools read,grep,find,ls --print "Review this project"
```

See [Settings](settings.md#tools) for configuring the default tool selection.

- `-t`, `--tools <list>`<br>
  Replaces the default selection with a comma-separated allowlist of built-in, extension, or custom tools. Entries are tool names or patterns where `*` matches any characters. MCP tools are kept unless an entry starts with `mcp__` (see [MCP tools](#tools)). A list of only `+name` and `-name` entries is not an allowlist; it changes the default selection instead.
- `-xt`, `--exclude-tools <list>`<br>
  Disables comma-separated tool names or patterns after all other selection options, MCP tools included.
- `-nbt`, `--no-builtin-tools`<br>
  Disables default built-in tools while retaining extension and custom tools.
- `-nt`, `--no-tools`<br>
  Starts with all built-in, extension, custom, and MCP tools disabled.

Default enabled tools are `read`, `bash`, `edit`, `write`, `memory`, `pr_watch`, `model_policy`, `model_upgrade`, and the orchestrator tools, unless `defaultTools` changes them. `--tools` with plain names replaces the whole selection, so name every tool you want. Like `defaultTools`, it also accepts a list of only `+name` and `-name` entries, which adds tools to or removes them from the default selection: `msa --tools +codemode,-write` keeps the other default tools, enables `codemode`, and disables `write`. These entries take exact tool names, not `*` patterns; use `--exclude-tools` to disable tools by pattern. Plain names and `+name`/`-name` entries cannot be mixed. `/reload` enables tools newly added to `defaultTools`, but a tool removed with `-name` stays removed.

The orchestrator tools are `create_task`, `list_tasks`, `read_task`, `set_task_depends`, `set_task_state`, `set_task_model`, `send_message`, `send_note`, `search_reports`, `stop_task`, `rerun_task`, `set_max_concurrent_threads`, `replan`, and `handoff`. They break the request into tasks: a task declares its current state, the goal state it must reach, and its dependencies; the worker thread receives those two states and decides how to get there. A task can also carry checks, the parts of the goal a command can measure: each is a shell command with the exit code (default 0) and optionally a regular expression its output must match, such as `{"command": "vp lint", "output": "Found 0 errors and 0 warnings"}` or `{"command": "rg -c 'layer-[0-9]' src", "exitCode": 1}` for a workaround that must not appear. When the worker ends its turn, the harness runs the checks in the worker's working directory; a failing result goes back to the worker instead of to the reviewer, and the task fails after three such rounds in a row. `create_task`, `replan`, and `set_task_state` take checks, and a task that `replan` replaces passes its checks on unless the new entry sets its own. In a git repository each work task gets its own worktree and branch: before the first thread of the task starts, the harness checks out branch `task/<id>` (the task id without `t-`) into `<repo>-<id>` next to the main checkout, branched from the default branch (`origin/HEAD`, fetched from `origin` just before the branch is cut, or the checked-out branch without a remote), and starts the worker and then its reviewer in the same subdirectory of it that the task's directory is in the main checkout; the checks run there too. A task created with `mergeInto` names another work task that has not started: it branches from that task's branch and does not open a pull request, and the target task, which the harness makes depend on it, is told to merge those branches and opens the one pull request. `set_task_depends` cannot remove that dependency; a task that `replan` replaces or drops stops merging, and tasks that merged into a replaced task merge into the first task that replaces it. A new `replan` task without `mergeInto` inherits the target of the first task it replaces that merges into a task outside the same entry, so an entry that replaces a task together with its target merges into nothing; `replan` refuses the inherited target when it has already started, unless the same replan replaces it too. A rerun reuses the task's worktree. When a thread ends, its worktree and branch stay, since they hold the commits and the open pull request. In a repository with an `origin` remote, a work task without `mergeInto` carries its own pull request: the harness finds the pull request whose head is the task's branch with `gh`, records its number, state, head SHA, CI result, and mergeable state, and shows them in `list_tasks`, `read_task` (which reads them again from GitHub), and `/tasks`; a task with `mergeInto` shows the pull request of the task it merges into. When the worker ends its turn, a default goal check runs alongside the task's checks: the pull request must exist and be open, its head must be the worktree's `HEAD`, it must not conflict with or be behind its base, and every CI check on its head must have passed, where a pull request whose head has had no check for 2 minutes since the harness first read it counts as a repository without CI. While CI is still running, or no check has registered on the head yet, and nothing else is wrong, the harness reads the pull request again every 30 seconds without waking the worker or using up one of its three rounds, and starts the reviewer once CI is green; after 3 hours of pending CI the task becomes `stopped`. A missing, unpushed, conflicting, behind, or failing pull request goes back to the worker like failing checks and uses up a round. When `gh` is missing, not logged in, or finds no GitHub repository at `origin`, the task becomes `stopped` with gh's reason instead of going back to the worker. The reviewer gets the pull request's number, head, title, and body, and checks that the body describes the final diff. After the review passes, the harness squash-merges the pull request with `gh pr merge --squash --match-head-commit` at the head that passed the goal check, and the task becomes `completed` only after GitHub reports it merged. Right before merging, the harness reads the pull request again and merges only when its head, title, and body are still the ones the goal check passed and the reviewer read; the squash commit takes that title, followed by the pull request number, and that body; the harness then removes the task's worktree and branch, locally and on `origin`, and those of the tasks that merged into it. When CI is running on the head at that point, the harness waits for it the same way before merging, without waking the worker. A pull request that fell behind, conflicts, fails CI, or whose head, title, or body changed after the check goes back to the worker in a new thread of the same worktree and is checked and reviewed again; after three passing reviews in a row whose pull request could not merge, the task becomes `stopped` with the reason instead, so a base that keeps moving does not send it back forever. When `gh pr merge` fails, or the task's run ends while the merge is in flight, the harness reads the pull request again: one merged at the head the harness recorded completes the task and removes the worktree and branches, one merged at another head is stopped as below, one that fell behind, conflicts, or fails CI goes back to the worker as above, and anything else leaves the task `stopped` with the reason. Workers and reviewers do not merge. On macOS and Linux their `bash` and `powershell` tools run with a `gh` wrapper (`<agent dir>/bin/worker/gh`) at the front of `PATH`, so a `gh` they start from `PATH`, from a variable, a script, or another language, refuses `gh pr merge`, the REST and GraphQL merge and auto-merge calls through `gh api` (including a GraphQL query read from a file or stdin with `-F query=@file`), a `gh alias set` or `gh alias import` that would merge, and any alias that expands to one of those, and passes everything else to the real `gh`. Before the shell starts, the command text is checked too, so `gh pr merge` and the merge calls through `gh api`, `curl`, or `wget` are refused early, and the GitHub MCP merge and auto-merge tools are refused; each refusal says why. These refusals are an early warning: a call that gets past them, such as a `gh` started by its absolute path, is caught afterwards from the harness's own record. Right before merging, the harness records the head it merges, and clears the record whenever the goal check, the merge step, or the end of an interrupted run reads the pull request as not merged; `read_task` and `/tasks` leave the record alone, so reading a task while the harness merges it does not make the merge look like someone else's. Every place that finds the pull request merged decides from that record alone: merged at the recorded head completes the task, any other merge stops it. When `gh pr merge` succeeds but the harness cannot read the pull request back, the task becomes `stopped` with that reason, and a rerun completes it and cleans up once the pull request reads as merged at the recorded head. The orchestrator's own session can merge. When a task's pull request turns out merged at a head the harness did not record, whether the goal check, the merge step after the review, or the end of an interrupted run finds it, the task becomes `stopped`, not `completed`, and the report names who merged it and the merge commit, as `gh` reports them. When the goal check or the merge step finds auto-merge turned on for the pull request, the task becomes `stopped` before GitHub can merge it, and the report names who turned it on. When `replan` replaces a task whose pull request is open, the first new task of the entry without `mergeInto` takes the pull request over and continues on its branch and worktree; when `replan` drops the task or no new task can take it, the result lists the open pull request, which stays on the closed task. Whenever a task carrying an open pull request ends `stopped` or `failed`, whether from `/tasks`, `stop_task`, the watchdog, its rounds running out, CI that never finishes, or gh being unavailable, the report the session gets names the pull request and its branch. Outside that flow, remove a worktree and branch with `git worktree remove` and `git branch -D` once they are no longer needed. Outside a git repository, and for a round's closing review, the thread runs in the task's directory. Dependencies are meant to be strict: tasks on the same area, branch, or precondition (such as a red main) are chained, and tasks run in parallel only when neither depends on the other's result. Once 3 or more work tasks of the project are `waiting` or `running`, `create_task` rejects a task with neither `dependsOn` nor `mergeInto` and lists the unfinished tasks. A round's closing review is not counted, since the scheduler starts it only after the round's work tasks finish, so it never runs alongside them. `stopped` and `failed` tasks are not counted either, since neither runs until `rerun_task` or `replan` starts it again. `replan` does not apply this rule: it is how a task that must run before existing tasks goes in, and it rewires the tasks it precedes. The scheduler starts tasks whose dependencies are finished within the concurrency limit, assigns a separate reviewer thread after each worker, and closes each round with a review task. The reviewer and the closing review fail the work on any finding within the goal of the task, however small, and report problems outside it separately; findings within the goal are fixed in the same pull request and reviewed again before it merges, and only problems outside the goal become separate issues. When a task's reviewer ends its turn, the harness asks the decision model (`decide`, see [settings](settings.md)) whether the report leaves a finding within the task's goal, giving it the report and the task's goal state. The judgement waits up to 10 minutes for the decision model to be fetched and loaded, so a review that ends before the model is ready, as in print mode where msa does not start loading it, is still judged. `pass` completes the task, or, for a task that carries a pull request, merges it as described above. `fail` sends the report back to the worker in a new thread of the same worktree and reviews the fix again; the task fails when the review still fails after three rounds of fixes. When the model cannot answer or neither answer reaches the threshold, the verdict is `undecided`: the task becomes `stopped`, not `completed`, and the report says why, so the orchestrator decides from the report. The verdict and its reason head the reviewer's report in `/tasks` and in the report the session gets; the verdict is stored with the report, so a worker restarted after the session reopens gets the findings again and the rounds keep counting. A round's closing review is not judged this way. Each report the session gets starts with the task's result, `completed`, `sent-back`, `waiting`, `stopped`, or `failed`, and carries the same value as its `status`, so a sent-back, stopped, or failed review never reads as completed. Dependencies and states change after creation while a task has not started; a running task is stopped first. Tasks, threads, reports, and shared notes live in SQLite (`orchestrator.database`, default `<agent dir>/orchestrator.db`); `/tasks` opens the DAG, where `d` edits a task's dependencies, `w` its current state, and `g` its goal state. Every minute the orchestrator checks its running threads: a thread with no tool call or message for 30 minutes (60 minutes while any tool call it made has not returned, including the rest of a parallel batch), a thread whose last turn ended in an error or abort without finishing, and a thread with no live run are stopped, their tasks become `stopped` (or `failed` for the error), and the session gets a report with the elapsed time; `rerun_task` continues them. A thread that is compacting is not checked. A worker or reviewer turn that ends on a provider error retries do not fix does not fail its task. The error is judged the same way as a session's own fallback to another model, by its HTTP status or the provider's error kind: 401, 402, 403, a rejected key, or a spent balance or quota, which includes a Claude Code usage limit reported by `claude-subs`. The task goes back to `waiting`, `/tasks` shows the error and when the task resumes, and the session gets a report saying the same. One minute after the reset time, or 15 minutes later when the error gives none, the scheduler reopens that thread's session in a new thread and tells it to continue, before it starts tasks that have not run yet; a reset time that has already passed counts as none. When a resumed thread stops on the same kind of error again before making any progress, the task is not resumed again on its own and not failed: it stays `waiting`, `/tasks` shows that it waits for a decision, and the report asks the orchestrator to decide. `send_message` resumes the same thread with the message, `rerun_task` starts the task over in a new thread, and `stop_task` stops it. A resumed thread that gets some work done before the next error waits for the reset again. Stopping the task drops the wait. Any other error leaves the task `failed` until `rerun_task`. When a session closes, or reopens after it ended without closing, its running tasks go back to `waiting` and the scheduler restarts them; the reopened session gets a report with how long each had gone without an update. The same happens to another session's running tasks once its orchestrator process is gone; a session that never recorded its process is left alone until it reopens. In fullscreen mode the screen splits into the conversation and a threads pane: `shift+right` opens `/tasks`, `shift+left` or `escape` returns, and dragging the divider or `ctrl+shift+left`/`ctrl+shift+right` resizes the pane.

`--tools` selects the tools declared to the model. It does not remove MCP tools, whose reach is set by their [exposure](mcp.md#control-tool-exposure): `msa --tools read,codemode` keeps every MCP tool callable from codemode scripts. An MCP tool that no entry names or matches is never declared directly, whatever its exposure; only `tool_search`, if listed, can load it. Once an entry starts with `mcp__`, `--tools` filters MCP tools too, so this keeps only the tools of the `github` server:

```sh
msa --tools read,bash,codemode,'mcp__github__*'
```

The MCP resource tools (`list_mcp_resources`, `list_mcp_resource_templates`, `read_mcp_resource`) count as MCP tools. To remove MCP tools, use `--exclude-tools 'mcp__*'` or [`--no-mcp`](#resources).

| Built-in                   | Purpose                                                          |
| -------------------------- | ---------------------------------------------------------------- |
| `read`                     | Read text files and supported images                             |
| `bash`                     | Run shell commands                                               |
| `powershell`               | Run PowerShell commands on Windows                               |
| `edit`                     | Apply exact text replacements to an existing file                |
| `write`                    | Create or overwrite a file                                       |
| `grep`                     | Search file contents                                             |
| `find`                     | Find paths using glob patterns                                   |
| `ls`                       | List directory contents                                          |
| `memory`                   | Remember, recall, and forget long-term memories in sepiace       |
| `pr_watch`                 | Watch a pull request and report CI, review, and merge changes    |
| `model_policy`             | Read and change `modelPolicy` from the model's side              |
| `model_upgrade`            | List and apply model upgrades                                    |
| `create_task` and the rest | Split the request into tasks and steer the threads that run them |

Built-in extensions add two more tools. They are off by default; the MCP extension turns them on when an MCP server needs them (see [MCP](mcp.md#control-tool-exposure)). To enable them yourself, name them in `--tools` or `defaultTools`.

| Built-in extension | Purpose                                                                                                                                           |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `codemode`         | Run JavaScript that calls the other tools, for example in parallel with `Promise.allSettled`; only the script's output reaches the model          |
| `tool_search`      | Search tools that are not declared to the model (`codemode` and `deferred` exposure, such as MCP tools) and declare the matches for the next call |

### Enable codemode

To turn on `codemode` for every session, add it to the default tools in `~/.msa/agent/settings.json` or a project's `.msa/settings.json`:

```json
{
  "defaultTools": ["+codemode"]
}
```

This keeps the default tools and adds `codemode`. For one invocation, add it with `--tools`:

```sh
msa --tools +codemode
```

Codemode is useful without MCP: scripts can run several tool calls in parallel, filter large output before it reaches the model, call classifier models such as TypeSafe's Jev through `models.classify()` (see [Classifier models](models.md#use-classifier-models)), and generate images through `models.generateImages()` (see [Image models](models.md#use-image-models)).

### How codemode works

Scripts run in a QuickJS sandbox and reach the other tools through `tools.<name>(args)`. [Codemode](codemode.md) describes the script API, how tools are listed and found, the `store()` and `models` globals, and the limits.

### Tool search

`tool_search` is off by default; enable it with `"defaultTools": ["+tool_search"]` or `--tools`. It uses the same ranking as `searchTools()` over tools that are not declared yet and declares the matches for the next model call. Loaded tools are recorded in the session like other tool changes, so they stay declared on that branch.

## Resources

```sh
msa --extension ./review.ts
```

See [Configuration](configuration.md) for conventional directories and project trust, [Settings](settings.md#resources) for configured paths, and [msa Packages](packages.md) for package sources.

- `-e`, `--extension <path>`<br>
  Loads an extension file or directory, or a built-in extension such as `builtin:mcp`, and is repeatable.
- `-ne`, `--no-extensions`<br>
  Disables discovered, configured, and built-in extensions. Explicit `-e` paths still load, so `msa -ne -e builtin:mcp` keeps only the built-in MCP support.
- `--no-mcp`<br>
  Disables the built-in MCP support for this run: no servers connect, and there are no MCP tools or `/mcp`. It does not affect an extension that replaces the built-in MCP support.
- `--skill <path>`<br>
  Loads a skill file or directory and is repeatable.
- `-ns`, `--no-skills`<br>
  Disables discovered and configured skills. Explicit `--skill` paths still load.
- `--prompt-template <path>`<br>
  Loads a prompt-template file or directory and is repeatable.
- `-np`, `--no-prompt-templates`<br>
  Disables discovered and configured templates. Explicit `--prompt-template` paths still load.
- `--theme <path>`<br>
  Loads a theme file or directory and is repeatable.
- `--use-theme <name[/name]>`<br>
  Selects the initial interactive theme for this run.
- `--no-themes`<br>
  Disables discovered and configured themes. Explicit `--theme` paths still load.
- `-nc`, `--no-context-files`<br>
  Disables `AGENTS.md` and `CLAUDE.md` discovery.

Resource paths apply only to the current process. Relative paths resolve from the current working directory.

## Prompts and process

```sh
msa --append-system-prompt ./instructions.md
```

See [Configuration](configuration.md) for saved configuration, [Security](security.md#understand-project-trust) for project trust, and [Environment Variables](environment-variables.md) for process controls.

- `--system-prompt <text|path>`<br>
  Replaces the default system prompt with text or the contents of an existing file; the `development_style` section stays.
- `--append-system-prompt <text|path>`<br>
  Appends text or an existing file to the system prompt and is repeatable.
- `--tui-mode <mode>`<br>
  Uses `fullscreen` (default) or `regular` terminal mode.
- `--verbose`<br>
  Shows verbose interactive startup information, overriding `quietStartup`.
- `-a`, `--approve`<br>
  Trusts project-local configuration and resources for this process.
- `-na`, `--no-approve`<br>
  Ignores trust-gated project-local configuration and resources for this process.
- `--offline`<br>
  Disables automatic network activity, including model catalog refreshes and downloading the decision model. Equivalent to `MSA_OFFLINE=1`.
- `-h`, `--help`<br>
  Shows help, including flags registered by loaded extensions, then exits.
- `-v`, `--version`<br>
  Shows the msa version, then exits.

Extensions may register additional long-form options. Unknown short options are rejected.

## Package commands

```sh
msa install npm:@scope/package
```

See [msa Packages](packages.md) for source formats, filtering, installation, and project scope.

### Common tasks

| Task                                    | Command                |
| --------------------------------------- | ---------------------- |
| Install a package                       | `msa install <source>` |
| List configured packages                | `msa list`             |
| Remove a package and its settings entry | `msa remove <source>`  |
| Configure which package resources load  | `msa config`           |

Add `--local` or `-l` to `install`, `remove`, `uninstall`, or `config` to use project settings instead of global settings.

### Update msa or packages

Running `msa update` without a target updates msa itself.

| Task                                  | Command                   |
| ------------------------------------- | ------------------------- |
| Update msa                            | `msa update`              |
| Update all installed packages         | `msa update --extensions` |
| Update one installed package          | `msa update <source>`     |
| Refresh model catalogs                | `msa update --models`     |
| Update msa and all installed packages | `msa update --all`        |

Add `--force` to reinstall msa when the selected update includes msa.

`msa update` cannot update msa when another package manager provides it, such as Nix. Update msa with that package manager, for example `nix profile upgrade msa`. Package and model catalog updates still work.

### Aliases and command options

- `msa uninstall <source>` is an alias for `msa remove <source>`.
- `msa update --self`, `msa update self`, and `msa update msa` are aliases for `msa update`.
- `msa update --extension <source>` is an alias for `msa update <source>`.
- `-a`, `--approve` trusts project-local files for one command. `-na`, `--no-approve` ignores trust-gated project-local files.
- Append `-h` or `--help` to a command for its exact usage and option constraints.

## Credential commands

```sh
msa auth check --provider openai --json
```

Authentication commands require `--provider <provider>` or `--model <model>`. See [Providers](providers.md) for supported methods.

| Command                       | Description                                                                               |
| ----------------------------- | ----------------------------------------------------------------------------------------- |
| `msa auth check`              | Print `ready`, `not_ready`, or `invalid`; exit with status `0`, `1`, or `2`, respectively |
| `msa auth print-api-key`      | Print the resolved API key                                                                |
| `msa auth print-bearer-token` | Print a resolved OAuth bearer token                                                       |

| Option                    | Applies to           | Description                                                                  |
| ------------------------- | -------------------- | ---------------------------------------------------------------------------- |
| `--provider <provider>`   | All                  | Resolve credentials for a provider                                           |
| `--model <model>`         | All                  | Resolve credentials from a model; may be combined with `--provider`          |
| `--json`                  | `auth check`         | Write the structured result as JSON                                          |
| `--credentials`           | `auth check`         | Emit the resolved credential when ready                                      |
| `--no-refresh`            | `auth check`         | Do not refresh expired OAuth credentials; refresh is the default             |
| `--min-expiry <duration>` | `print-bearer-token` | Require remaining token lifetime using `ms`, `s`, `m`, or `h`, such as `30m` |

Credential-printing commands write secrets to stdout.

## MCP commands

These commands work outside a session, so agents can run them through `bash`. See [MCP Servers](mcp.md).

| Command                                                 | Description                                                                                                                                                                                                                                                                    |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `msa mcp add <server> [options] -- <command> [args...]` | Add or replace a stdio server in `mcp.json`; `--env KEY=VALUE` (repeatable) and `--cwd <dir>` set its environment and working directory. Arguments after the command are passed to it                                                                                          |
| `msa mcp add <server> [options] --url <url>`            | Add or replace a streamable HTTP server; `--header KEY=VALUE` (repeatable), `--bearer-token-env-var <NAME>` (sends `Authorization: Bearer ${NAME}`), `--oauth-client-id`, `--oauth-client-secret`, `--oauth-callback-port`, and `--oauth-client-name` configure authentication |
| `msa mcp remove <server>`                               | Remove a server from `mcp.json`; stored OAuth credentials are kept                                                                                                                                                                                                             |
| `msa mcp list [--json]`                                 | Connect to every enabled server and print its state, tools, and errors; exit with `1` when a config entry is invalid or an enabled server is not connected                                                                                                                     |
| `msa mcp login <server> [--timeout <seconds>]`          | Sign in to an OAuth server: open the authorization page and wait for the browser; a terminal also accepts the pasted redirect URL. `--timeout` limits the whole sign-in, including requests to the authorization server (default 300 seconds)                                  |
| `msa mcp logout <server>`                               | Delete the stored OAuth credentials of a server                                                                                                                                                                                                                                |

`add` and `remove` change `~/.msa/agent/mcp.json`, or `.msa/mcp.json` in the current directory with `--local` (`-l`). `add` also takes `--exposure <mode>` (see [Exposure](mcp.md#control-tool-exposure)) and `--description <text>` and does not connect; run `msa mcp list` to check the server.

Project `.msa/mcp.json` files are only read for projects that are already trusted.
