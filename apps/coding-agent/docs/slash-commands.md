# Slash commands

Type `/` in msa's terminal editor to search the commands available in the current session, or run `/help` to list them. This page lists the built-in commands in the current msa release.

Built-in commands follow Claude Code's names. The names in the Aliases column run the same command, so both Claude Code and earlier msa spellings work.

Extensions, prompt templates, and skills can add commands. The command menu in msa is therefore the exact reference for the resources loaded in your session.

## Models and settings

| Command                   | Aliases               | Description                                      |
| ------------------------- | --------------------- | ------------------------------------------------ |
| `/config`                 | `/settings`, `/theme` | Open settings                                    |
| `/model [provider/model]` |                       | Select a model                                   |
| `/effort [level]`         | `/thinking`           | Set the thinking level                           |
| `/scoped-models`          |                       | Configure the models used by interactive cycling |
| `/login [provider]`       |                       | Add provider authentication                      |
| `/logout`                 |                       | Remove provider authentication                   |
| `/llama`                  |                       | Manage models on the configured llama.cpp router |

## Sessions and context

| Command                    | Aliases                                             | Description                                                                                                                                                       |
| -------------------------- | --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/clear`                   | `/new`, `/reset`                                    | Start a new session                                                                                                                                               |
| `/resume`                  |                                                     | Switch to another saved session                                                                                                                                   |
| `/rename [name]`           | `/name`                                             | Set the session display name, or show the current name when omitted                                                                                               |
| `/status`                  | `/session`, `/usage`, `/cost`, `/stats`, `/context` | Show current session information, token usage, and cost                                                                                                           |
| `/rewind`                  | `/tree`, `/checkpoint`, `/undo`                     | Navigate the session tree                                                                                                                                         |
| `/fork`                    |                                                     | Create a new session from an earlier user message                                                                                                                 |
| `/branch`                  | `/clone`                                            | Duplicate the current session at its current position                                                                                                             |
| `/compact [instructions]`  |                                                     | Compact the current context, optionally with custom instructions                                                                                                  |
| `/goal [condition\|clear]` |                                                     | Keep working across turns until an evaluator model judges the condition met; without an argument, show the goal's elapsed time, turns, tokens, and latest verdict |
| `/init`                    |                                                     | Ask the model to write an `AGENTS.md` that describes the repository                                                                                               |
| `/import <path>`           |                                                     | Import and resume a JSONL session                                                                                                                                 |

## Export and share

| Command              | Aliases     | Description                                         |
| -------------------- | ----------- | --------------------------------------------------- |
| `/copy`              |             | Copy the last assistant message                     |
| `/export [path]`     |             | Export the session as HTML or JSONL                 |
| `/share`             |             | Upload the session and return a viewer link         |
| `/bug [description]` | `/feedback` | Prepare a private bug report for the msa developers |

Review a session before exporting or sharing it. Sessions can contain prompts, tool arguments, command output, file contents, and credentials exposed during the conversation.

## Runtime and project

| Command          | Aliases                             | Description                                                                  |
| ---------------- | ----------------------------------- | ---------------------------------------------------------------------------- |
| `/help`          |                                     | List the available commands                                                  |
| `/trust`         |                                     | Save a project trust decision for future msa processes                       |
| `/reload`        | `/reload-skills`, `/reload-plugins` | Reload keybindings, extensions, skills, templates, themes, and context files |
| `/keybindings`   | `/hotkeys`                          | Show active keyboard shortcuts                                               |
| `/release-notes` | `/changelog`                        | Show changelog entries                                                       |
| `/exit`          | `/quit`                             | Exit msa                                                                     |

## Commands added by resources

- Extensions can register commands with their own arguments and completion behavior.
- Each prompt template is available under its template name.
- Skills are available as `/name`, as in Claude Code, when skill commands are enabled. When a built-in command, an extension command, or a prompt template already uses the name, the skill is listed as `/skill:name`. `/skill:name` always works.

Built-in commands and their aliases take precedence over commands with the same name. Use `/reload` after adding or changing a discovered command resource. See [Extensions](extensions.md), [Prompt Templates](prompt-templates.md), and [Skills](skills.md) for their loading and naming rules.
