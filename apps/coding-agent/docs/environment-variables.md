# Environment Variables

msa uses environment variables in three ways:

- Variables such as `MSA_OFFLINE` configure the msa process.
- msa sets process markers so child processes can identify msa as the launching agent.
- Commands run by the LLM-callable shell tools receive `MSA_*` variables describing the current session.

Provider API-key variables are documented separately in [Providers](providers.md#use-an-api-key-from-the-environment).

## Process Marker

The CLI and RPC entry points set two process markers:

- `AI_AGENT=msa` is a generic marker that lets tooling identify msa as the agent that launched the process.
- `MSA_CODING_AGENT=true` is msa-specific and lets child processes detect that they run inside msa.

Child processes inherit both markers. They are not session-specific and are not set automatically when msa is embedded through the SDK.

## Shell Tool Session Environment

Commands run by the `bash` and `powershell` tools receive the current msa session state:

| Variable              | Description                                                                                     |
| --------------------- | ----------------------------------------------------------------------------------------------- |
| `MSA_SESSION_ID`      | Current session ID                                                                              |
| `MSA_SESSION_FILE`    | Absolute path to the current session JSONL file; unset for ephemeral sessions                   |
| `MSA_PROVIDER`        | Currently selected model provider                                                               |
| `MSA_MODEL`           | Currently selected model ID                                                                     |
| `MSA_REASONING_LEVEL` | Current effective reasoning level: `off`, `minimal`, `low`, `medium`, `high`, `xhigh`, or `max` |

The values are resolved when each command starts. Switching models or changing the reasoning level therefore affects the next shell command without restarting msa. `MSA_PROVIDER` and `MSA_MODEL` identify the selected msa model, not a different upstream model that a router may choose internally.

When asked which model or provider is running, inspect these variables instead of inferring the answer from the system prompt:

```bash
printf '%s/%s\n' "$MSA_PROVIDER" "$MSA_MODEL"
printf 'reasoning=%s session=%s\n' "$MSA_REASONING_LEVEL" "$MSA_SESSION_ID"
```

The session file can be inspected directly when the session is persistent:

```bash
if [ -n "$MSA_SESSION_FILE" ]; then
  tail -n 1 "$MSA_SESSION_FILE"
fi
```

These variables are injected into the LLM-callable `bash` and `powershell` tools. They are not injected into user-entered `!` or `!!` commands.

### Custom Shell Tools

Tools created with `createBashTool()` or `createPowerShellTool()` expose the session environment by default when registered with msa. Injection happens before `spawnHook`, so a hook receives the variables in `ctx.env`:

```typescript
const bashTool = createBashTool(cwd, {
  spawnHook: (ctx) => ({
    ...ctx,
    env: { ...ctx.env, CI: "1" },
  }),
});
```

Disable session metadata independently of the spawn hook:

```typescript
const powershellTool = createPowerShellTool(cwd, {
  exposeSessionEnvironment: false,
  spawnHook: (ctx) => ctx,
});
```

When disabled, msa removes inherited values for these variables so nested msa processes do not expose stale parent-session metadata.

## msa Process Configuration

These variables are read by msa itself:

| Variable                                  | Description                                                                                                                                                                                                                                                      |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `MSA_CODING_AGENT_DIR`                    | Override the config directory; default is `~/.msa/agent`                                                                                                                                                                                                         |
| `MSA_CODING_AGENT_SESSION_DIR`            | Override session storage; overridden by `--session-dir`                                                                                                                                                                                                          |
| `MSA_PACKAGE_DIR`                         | Override the package directory, useful for Nix/Guix store paths                                                                                                                                                                                                  |
| `MSA_OFFLINE`                             | Disable automatic network activity, including model catalog refreshes and downloading the decision model                                                                                                                                                         |
| `MSA_SKIP_VERSION_CHECK`                  | Disable the GitHub Releases latest-version request                                                                                                                                                                                                               |
| `MSA_OTLP_ENDPOINT`                       | OTLP/HTTP base URL that receives traces, metrics, and logs, such as `http://collector:4318`; overrides `telemetry.otlpEndpoint`. See [Telemetry](telemetry.md)                                                                                                   |
| `MSA_TELEMETRY`                           | Override provider attribution headers: `1`/`true`/`yes` or `0`/`false`/`no`                                                                                                                                                                                      |
| `MSA_CACHE_RETENTION`                     | Set to `long` for extended provider prompt caching where supported                                                                                                                                                                                               |
| `MSA_SHARE_VIEWER_URL`                    | Override the base URL used by `/share`                                                                                                                                                                                                                           |
| `MSA_HARDWARE_CURSOR`                     | Set to `1` to show the hardware cursor; see [Terminal setup](terminal-setup.md)                                                                                                                                                                                  |
| `MSA_CLIPBOARD_OSC52`                     | Set to `1` to also send copied text to the terminal with OSC 52 after the local clipboard write, as msa does over SSH. Use it when a remote client reaches msa without SSH variables, such as a multiplexer attached from another machine or a remote IDE daemon |
| `MSA_HYPERLINKS`                          | Override OSC 8 hyperlink detection with `1`, `0`, or `auto`                                                                                                                                                                                                      |
| `MSA_PROGRAM_STATUS`                      | Override OSC 7501 program status detection: `1` always reports, `0` never reports; otherwise msa reports only after the terminal confirms support. See [Terminal setup](terminal-setup.md#program-status)                                                        |
| `MSA_IMAGE_PROTOCOL`                      | Override inline image detection with `kitty`, `iterm2`, `none`, or `auto`                                                                                                                                                                                        |
| `MSA_TRUE_COLOR`                          | Override truecolor detection with `1`, `0`, or `auto`                                                                                                                                                                                                            |
| `MSA_TUI_ESC_TIMEOUT`                     | How long to wait after a lone ESC before treating it as Escape, in milliseconds; defaults to `100` over SSH and `10` otherwise. Increase if Alt-key input is misread as Escape                                                                                   |
| `VISUAL`, `EDITOR`                        | External editor fallback when `externalEditor` is unset                                                                                                                                                                                                          |
| `HTTP_PROXY`, `HTTPS_PROXY`               | Proxy outbound HTTP requests                                                                                                                                                                                                                                     |
| `OPENCODE_BIN`, `OPENCODE_FREE_DATA_HOME` | OpenCode binary and data directory for the `opencode-free` provider; see [Claude Code and OpenCode as models](cli-agents.md)                                                                                                                                     |
| `CLAUDE_BIN`                              | Claude Code binary for the `claude-subs` provider and `/login claude-code`; defaults to `claude` on `PATH`                                                                                                                                                       |

Provider credentials such as `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, and provider-specific configuration are listed in [Providers](providers.md#use-an-api-key-from-the-environment).
