# Claude Code and OpenCode as Models

msa can use another coding agent's subscription as a model. `claude-subs` runs on a Claude subscription (Pro/Max); `anthropic-api` is the pay-per-token Anthropic API with an API key ([Providers](providers.md)).

| Provider        | Runs                                                                   | Tools                                                                                |
| --------------- | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `claude-subs`   | Claude Code through the Claude Agent SDK, under your Claude Code login | msa's own tools; Claude Code's tools, hooks, settings, plugins and CLAUDE.md are off |
| `opencode-free` | `opencode run` with OpenCode Zen's free models                         | OpenCode's own tools                                                                 |

```bash
msa --model claude-subs/opus
msa --model opencode-free/glm-5.3-flash-free
```

## Claude Code

Install [Claude Code](https://code.claude.com) and log in with `claude` or `/login claude-code`. msa runs the `claude` it finds on `PATH` (`CLAUDE_BIN` overrides it); without one, `claude-subs` is not listed.

Thinking levels map to Claude Code's effort. One Claude Code process serves a conversation while it continues from its own last reply; branching, compaction, or a turn from another provider starts a new process from the transcript.

### Several accounts

List accounts in `~/.msa/agent/claude-code-accounts.json`:

```json
{
  "accounts": [
    { "name": "main", "configDir": "~/.claude" },
    { "name": "second", "configDir": "~/.claude-second" },
    { "name": "token", "tokenCommand": "op read op://vault/claude/token" },
    { "name": "work", "tokenCommand": "pass show claude/work", "auto": false }
  ]
}
```

- `configDir` uses the Claude Code login stored for that config directory. On macOS it is in the login keychain, which an SSH session cannot read.
- `tokenCommand` runs in `$SHELL` and prints a `claude setup-token` token. The token goes only to that account's Claude Code process.
- `claude-subs` uses the first account that is not blocked. An account that hits its usage limit is blocked until the reset time in the message; a logged-out account for 10 minutes. The request then moves to the next account.
- `claude-subs-<name>` always uses that account. `"auto": false` keeps an account out of `claude-subs`.

`/accounts claude` lists the accounts and their blocks; `/accounts claude clear` lifts the blocks. `/accounts claude add|login|logout|remove|use|enable|disable <name>` manages them.

## OpenCode

Install [OpenCode](https://opencode.ai). msa runs `~/.opencode/bin/opencode`; set `OPENCODE_BIN` to use another binary. Runs keep their data in `~/.local/share/msa-opencode-free` (`OPENCODE_FREE_DATA_HOME`), apart from your own OpenCode sessions.
