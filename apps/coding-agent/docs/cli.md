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
msa --model sonnet:high
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
- `--orchestrator`<br>
  Adds the orchestrator tools (`create_task`, `list_tasks`, `read_task`, `set_task_depends`, `set_task_instruction`, `set_task_priority`, `set_task_model`, `send_message`, `send_note`, `search_reports`, `stop_task`, `rerun_task`, `set_max_concurrent_sessions`, `replan`). Tasks declare their dependencies and the paths they touch; the scheduler starts them within the path and concurrency limits, assigns a separate reviewer session after each worker, and closes each round with a review task. Dependencies and instructions change after creation while a task has not started; a running task is stopped first. Tasks, sessions, reports, and shared notes live in SQLite (`orchestrator.database`, default `<agent dir>/orchestrator.db`); `/sessions` opens the DAG, where `d` edits a task's dependencies and `i` its instruction.

Default enabled tools are `read`, `bash`, `edit`, `write`, `memory`, and `pr_watch`, unless `defaultTools` changes them. `--tools` with plain names replaces the whole selection, so name every tool you want. Like `defaultTools`, it also accepts a list of only `+name` and `-name` entries, which adds tools to or removes them from the default selection: `msa --tools +codemode,-write` keeps the other default tools, enables `codemode`, and disables `write`. These entries take exact tool names, not `*` patterns; use `--exclude-tools` to disable tools by pattern. Plain names and `+name`/`-name` entries cannot be mixed. `/reload` enables tools newly added to `defaultTools`, but a tool removed with `-name` stays removed.

`--tools` selects the tools declared to the model. It does not remove MCP tools, whose reach is set by their [exposure](mcp.md#control-tool-exposure): `msa --tools read,codemode` keeps every MCP tool callable from codemode scripts. An MCP tool that no entry names or matches is never declared directly, whatever its exposure; only `tool_search`, if listed, can load it. Once an entry starts with `mcp__`, `--tools` filters MCP tools too, so this keeps only the tools of the `github` server:

```sh
msa --tools read,bash,codemode,'mcp__github__*'
```

The MCP resource tools (`list_mcp_resources`, `list_mcp_resource_templates`, `read_mcp_resource`) count as MCP tools. To remove MCP tools, use `--exclude-tools 'mcp__*'` or [`--no-mcp`](#resources).

| Built-in     | Purpose                                                       |
| ------------ | ------------------------------------------------------------- |
| `read`       | Read text files and supported images                          |
| `bash`       | Run shell commands                                            |
| `powershell` | Run PowerShell commands on Windows                            |
| `edit`       | Apply exact text replacements to an existing file             |
| `write`      | Create or overwrite a file                                    |
| `grep`       | Search file contents                                          |
| `find`       | Find paths using glob patterns                                |
| `ls`         | List directory contents                                       |
| `memory`     | Save, search, list, and forget long-term memories             |
| `pr_watch`   | Watch a pull request and report CI, review, and merge changes |

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
  Replaces the default system prompt with text or the contents of an existing file.
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
  Disables automatic network activity, including model catalog refreshes. Equivalent to `MSA_OFFLINE=1`.
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
