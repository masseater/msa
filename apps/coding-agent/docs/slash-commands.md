# Slash commands

Type `/` in msa's terminal editor to search the commands available in the current session, or run `/help` to list them. This page lists the built-in commands in the current msa release.

Built-in commands follow Claude Code's names. The names in the Aliases column are Claude Code's aliases and run the same command.

Extensions, prompt templates, and skills can add commands. The command menu in msa is therefore the exact reference for the resources loaded in your session.

## Models and settings

| Command                            | Aliases               | Description                                                               |
| ---------------------------------- | --------------------- | ------------------------------------------------------------------------- |
| `/config`                          | `/settings`, `/theme` | Open settings                                                             |
| `/model [provider/model\|upgrade]` |                       | Select a model, or list and apply model upgrades                          |
| `/effort [level]`                  |                       | Set the thinking level                                                    |
| `/scoped-models`                   |                       | Configure the models used by interactive cycling                          |
| `/login [provider]`                |                       | Add provider authentication                                               |
| `/logout`                          |                       | Remove provider authentication                                            |
| `/accounts [kind ...]`             |                       | Manage Claude accounts; see [Claude Code](cli-agents.md#several-accounts) |
| `/llama`                           |                       | Manage models on the configured llama.cpp router                          |

## Sessions and context

| Command                    | Aliases                                 | Description                                                                                                                                                                 |
| -------------------------- | --------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/clear`                   | `/new`, `/reset`                        | Start a new session                                                                                                                                                         |
| `/resume`                  | `/continue`                             | Switch to another saved session                                                                                                                                             |
| `/rename [name]`           |                                         | Set the session display name, or show the current name when omitted                                                                                                         |
| `/status`                  | `/usage`, `/cost`, `/stats`, `/context` | Show current session information, token usage, and cost                                                                                                                     |
| `/rewind`                  | `/checkpoint`, `/undo`                  | Navigate the session tree                                                                                                                                                   |
| `/fork`                    |                                         | Create a new session from an earlier user message                                                                                                                           |
| `/branch`                  |                                         | Duplicate the current session at its current position                                                                                                                       |
| `/compact [instructions]`  |                                         | Compact the current context, optionally with custom instructions                                                                                                            |
| `/goal [condition\|clear]` |                                         | Keep working across turns until an evaluator model judges the condition met; without an argument, show the goal's elapsed time, turns, tokens, and latest verdict           |
| `/ask <question>`          |                                         | Send a question for this turn only; the model can answer, and nothing it is given can change anything. See [Ask a question](#ask-a-question)                                |
| `/init`                    |                                         | Ask the model to write an `AGENTS.md` that describes the repository                                                                                                         |
| `/import <path>`           |                                         | Import and resume a JSONL session                                                                                                                                           |
| `/memory [request]`        |                                         | Show the sepiace memory status, sign in or out, or send sepiace a request such as `forget my old address`; see [Long-Term Memory](memory.md)                                |
| `/search [words]`          |                                         | Search past sessions and orchestrator threads, and read on from a match; see [Search Past Sessions](session-search.md)                                                      |
| `/tasks`                   | `/threads`                              | Open the task DAG, and steer the threads the orchestrator runs                                                                                                              |
| `/handoff [path]`          |                                         | Write the orchestrator's state to one Markdown file, and print the line to paste into the next session. See [Hand over to the next session](#hand-over-to-the-next-session) |

## Export and share

| Command              | Aliases     | Description                                 |
| -------------------- | ----------- | ------------------------------------------- |
| `/copy`              |             | Copy the last assistant message             |
| `/export [path]`     |             | Export the session as HTML or JSONL         |
| `/share`             |             | Upload the session and return a viewer link |
| `/bug [description]` | `/feedback` | Export a bug report as a zip archive        |

Review a session before exporting or sharing it. Sessions can contain prompts, tool arguments, command output, file contents, and credentials exposed during the conversation.

## Runtime and project

| Command          | Aliases                             | Description                                                                  |
| ---------------- | ----------------------------------- | ---------------------------------------------------------------------------- |
| `/help`          |                                     | List the available commands                                                  |
| `/trust`         |                                     | Save a project trust decision for future msa processes                       |
| `/reload`        | `/reload-skills`, `/reload-plugins` | Reload keybindings, extensions, skills, templates, themes, and context files |
| `/keybindings`   |                                     | Show active keyboard shortcuts                                               |
| `/release-notes` |                                     | Show changelog entries                                                       |
| `/exit`          | `/quit`                             | Exit msa                                                                     |

## Ask a question

`/ask <question>` sends the question as an ordinary user message, and only for that turn the model has nothing that works. msa declares the tools that carry `annotations.readOnlyHint: true` and leaves out every other tool, so a tool an extension or MCP server adds without the mark is left out too. The system prompt gains one section that says to answer, and to propose work without starting it. The next turn declares every tool again and drops the section.

These stay: `read`, `grep`, `find`, `ls`, `web_search`, `web_fetch`, `list_tasks`, `read_task`, `search_reports`, `search_sessions`, and the read-only MCP tools. `pr_watch`, `model_policy`, and `model_upgrade` keep `list`. `memory` is left out, because sepiace decides from the request whether to save or forget. `bash`, `powershell`, `edit`, `write`, the task and message tools that change anything, `codemode`, and `tool_search` are left out.

The same turn is available from [RPC](rpc-commands.md#prompt) with `"mode": "ask"`, and from the SDK with `session.run.prompting.prompt(question, { mode: "ask" })`. An extension author marks a tool with `annotations: { readOnlyHint: true }`, and gives a tool that reads and writes through one `action` a `readOnlyVariant` ([Tool exposure](extensions.md#tool-exposure)).

## Commands added by resources

- Extensions can register commands with their own arguments and completion behavior.
- Each prompt template is available under its template name.
- Skills are available as `/name`, as in Claude Code. A skill takes its name from a built-in command, an extension command, or a prompt template of the same name; the built-in command keeps its aliases.

Use `/reload` after adding or changing a discovered command resource. See [Extensions](extensions.md), [Prompt Templates](prompt-templates.md), and [Skills](skills.md) for their loading and naming rules.

## Hand over to the next session

`/handoff [path]` has the model write three sections from the conversation: the premise, the goal states in dependency order, and what must not be started. The `handoff` tool saves them with everything it reads itself: the date, the msa version, the repository and branch, the open pull requests and issues (when `gh` works), every task with its states, model, dependencies, and last report, the shared notes, the waiting and running tasks, and the latest replans. The file goes to `<agent dir>/handoffs/<timestamp>-<id>.md`, or to `path`; a directory gets a generated name. The screen shows one line, `<path> を読んで再開して`. Running tasks keep running; the file lists them with `stop_task` as the way to stop them.

Start the next session with that line. The model reads the file with `read` and re-creates the tasks with `create_task`, with dependencies, in the order of the goal states.

A fresh interactive session with the orchestrator also looks in `handoffs/`. When a file has not been taken yet, msa asks once whether to resume from it, listing them newest first when there are several. Yes passes the file's text as the first turn; no does nothing. A file that was resumed is recorded in `handoffs/consumed.json` and is not offered again; the file itself stays where it is.
