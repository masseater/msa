import chalk from "chalk";

import config from "../../config.ts";
import type extensionsTypesTypes from "../../core/extensions/types.types.ts";
import platform from "../../core/platform/index.ts";

const { writeLog } = platform;
const { APP_NAME, CONFIG_DIR_NAME, ENV_AGENT_DIR, ENV_SESSION_DIR } = config;

const USAGE_HELP = `  ${APP_NAME} [options] [--] [@files...] [messages...]`;

const COMMANDS_HELP = `  ${APP_NAME} install <source> [-l]     Install extension source and add to settings
  ${APP_NAME} remove <source> [-l]      Remove extension source from settings
  ${APP_NAME} uninstall <source> [-l]   Alias for remove
  ${APP_NAME} update [source|self|msa]   Update msa, extensions, or model catalogs
  ${APP_NAME} list                      List installed extensions from settings
  ${APP_NAME} config [-l]               Open TUI to enable/disable package resources (Tab switches scope)
  ${APP_NAME} auth <command>            Print credentials or check provider readiness
  ${APP_NAME} mcp <command>             Check MCP servers, sign in to or out of OAuth servers
  ${APP_NAME} squash-message <n> <sha>  Print the commit message the harness squash-merges PR <n> with at <sha>
  ${APP_NAME} <command> --help          Show help for install/remove/uninstall/update/list/config/auth/mcp/squash-message`;

const OPTIONS_HELP = `  --provider <name>              Provider to search for --model (requires --model)
  --model <pattern>              Model pattern or ID (supports "provider/id" and optional ":<thinking>")
  --api-key <key>                API key (defaults to env vars)
  --system-prompt <text>         System prompt (default: coding assistant prompt)
  --append-system-prompt <text>  Append text or file contents to the system prompt (can be used multiple times)
  --mode <mode>                  Output mode: text (default), json, or rpc
  --print, -p                    Non-interactive mode: process prompt and exit
  --continue, -c                 Continue previous session
  --resume, -r                   Select a session to resume
  --session <path|id>            Use specific session file or partial UUID
  --session-id <id>              Use exact project session ID, creating it if missing
  --fork <path|id>               Fork specific session file or partial UUID into a new session
  --session-dir <dir>            Directory for session storage and lookup
  --no-session                   Don't save session (ephemeral)
  --name, -n <name>              Set session display name
  --models <patterns>            Comma-separated model patterns for Ctrl+P cycling
                                 Supports globs (anthropic/*, *sonnet*) and fuzzy matching
  --no-tools, -nt                Disable all tools by default (built-in and extension)
  --no-builtin-tools, -nbt       Disable built-in tools by default but keep extension/custom tools enabled
  --tools, -t <tools>            Comma-separated allowlist of tool names or patterns (*) to enable
                                 Keeps MCP tools unless an entry starts with mcp__
                                 Only +name/-name entries add to or remove from the defaults
  --exclude-tools, -xt <tools>   Comma-separated denylist of tool names or patterns (*) to disable
                                 Applies to all tools, MCP tools included
  --thinking <level>             Set thinking level: off, minimal, low, medium, high, xhigh, max
  --extension, -e <path>         Load an extension file or builtin:<name> (can be used multiple times)
  --no-extensions, -ne           Disable extension discovery and built-in extensions (explicit -e paths still work)
  --no-mcp                       Disable built-in MCP support: no servers connect and no MCP tools
  --skill <path>                 Load a skill file or directory (can be used multiple times)
  --no-skills, -ns               Disable skills discovery and loading
  --prompt-template <path>       Load a prompt template file or directory (can be used multiple times)
  --no-prompt-templates, -np     Disable prompt template discovery and loading
  --theme <path>                 Load a theme file or directory (can be used multiple times)
  --use-theme <name[/name]>      Set the initial interactive theme for this run
  --no-themes                    Disable theme discovery and loading
  --no-context-files, -nc        Disable AGENTS.md and CLAUDE.md discovery and loading
  --export <file>                Export session file to HTML and exit
  --list-models [search]         List available models (with optional fuzzy search)
  --verbose                      Force verbose startup (overrides quietStartup setting)
  --tui-mode <mode>              TUI mode: fullscreen (default) or regular
  --approve, -a                  Trust project-local files for this run
  --no-approve, -na              Ignore project-local files for this run
  --offline                      Disable startup network operations (same as MSA_OFFLINE=1)
  --                             End option parsing; treat remaining arguments as messages/files
  --help, -h                     Show this help
  --version, -v                  Show version number

Extensions can register additional flags (e.g., --plan from plan-mode extension).`;

const EXAMPLES_HELP = `  # Print a provider API key for an external client
  ${APP_NAME} auth print-api-key --provider openai

  # Print an OAuth bearer token for an external client (refreshes if expired)
  ${APP_NAME} auth print-bearer-token --provider openai-codex

  # Interactive mode
  ${APP_NAME}

  # Interactive mode with initial prompt
  ${APP_NAME} "List all .ts files in src/"

  # Include files in initial message
  ${APP_NAME} @prompt.md @image.png "What color is the sky?"

  # Non-interactive mode (process and exit)
  ${APP_NAME} -p "List all .ts files in src/"

  # Prompt beginning with a dash
  ${APP_NAME} -p -- "- Summarize these points"

  # Multiple messages (interactive)
  ${APP_NAME} "Read package.json" "What dependencies do we have?"

  # Continue previous session
  ${APP_NAME} --continue "What did we discuss?"

  # Start a named session
  ${APP_NAME} --name "Refactor auth module"

  # Use different model
  ${APP_NAME} --provider openai --model gpt-4o-mini "Help me refactor this code"

  # Use model with provider prefix (no --provider needed)
  ${APP_NAME} --model openai/gpt-4o "Help me refactor this code"

  # Use model with thinking level shorthand
  ${APP_NAME} --model claude-sonnet-5-5:high "Solve this complex problem"

  # Limit model cycling to specific models
  ${APP_NAME} --models claude-sonnet,claude-haiku,gpt-4o

  # Limit to a specific provider with glob pattern
  ${APP_NAME} --models "openai/*"

  # Cycle models with fixed thinking levels
  ${APP_NAME} --models claude-sonnet-5-5:high,claude-haiku-5-5:low

  # Start with a specific thinking level
  ${APP_NAME} --thinking high "Solve this complex problem"

  # Read-only mode (no file modifications possible)
  ${APP_NAME} --tools read,grep,find,ls -p "Review the code in src/"

  # Add codemode to the default tools
  ${APP_NAME} --tools +codemode

  # Codemode with only the tools of one MCP server
  ${APP_NAME} --tools read,bash,codemode,'mcp__github__*'

  # Disable one tool while keeping the rest available
  ${APP_NAME} --exclude-tools ask_question

  # Export a session file to HTML
  ${APP_NAME} --export ~/${CONFIG_DIR_NAME}/agent/sessions/--path--/session.jsonl
  ${APP_NAME} --export session.jsonl output.html`;

const ENVIRONMENT_HELP = `  ANTHROPIC_AUTH_TOKEN             - Anthropic bearer auth token
  ANTHROPIC_API_KEY                - Anthropic Claude API key
  OPENAI_API_KEY                   - OpenAI GPT API key
  OPENROUTER_API_KEY               - OpenRouter API key
  OPENCODE_API_KEY                 - OpenCode Zen/OpenCode Go API key
  ${ENV_AGENT_DIR.padEnd(32)} - Config directory (default: ~/${CONFIG_DIR_NAME}/agent)
  ${ENV_SESSION_DIR.padEnd(32)} - Session storage directory (overridden by --session-dir)
  MSA_PACKAGE_DIR                   - Override package directory (for Nix/Guix store paths)
  MSA_OFFLINE                       - Disable startup network operations when set to 1/true/yes
  MSA_TELEMETRY                     - Override provider attribution headers when set to 1/true/yes or 0/false/no
  MSA_SHARE_VIEWER_URL              - Base URL for /share command (default: https://pi.dev/session/)`;

const TOOL_NAMES_HELP = `  read       - Read file contents
  bash       - Execute bash commands
  powershell - Execute PowerShell commands on Windows
  edit       - Edit files with find/replace
  write      - Write files (creates/overwrites)
  grep       - Search file contents (read-only, off by default)
  find       - Find files by glob pattern (read-only, off by default)
  ls         - List directory contents (read-only, off by default)
`;

function extensionFlagsHelp(
  extensionFlags: extensionsTypesTypes.ExtensionFlag[] | undefined,
): string {
  return extensionFlags !== undefined && extensionFlags.length > 0
    ? `\n${chalk.bold("Extension CLI Flags:")}\n${extensionFlags
        .map((flag) => {
          const value = flag.type === "string" ? " <value>" : "";
          const description = flag.description ?? `Registered by ${flag.extensionPath}`;
          return `  --${flag.name}${value}`.padEnd(30) + description;
        })
        .join("\n")}\n`
    : "";
}

function printHelp(extensionFlags?: extensionsTypesTypes.ExtensionFlag[]): void {
  writeLog(
    `${chalk.bold(APP_NAME)} - AI coding assistant with read, bash, edit, write tools\n\n${chalk.bold("Usage:")}\n${USAGE_HELP}\n\n${chalk.bold("Commands:")}\n${COMMANDS_HELP}\n\n${chalk.bold("Options:")}\n${OPTIONS_HELP}${extensionFlagsHelp(extensionFlags)}\n\n${chalk.bold("Examples:")}\n${EXAMPLES_HELP}\n\n${chalk.bold("Environment Variables:")}\n${ENVIRONMENT_HELP}\n\n${chalk.bold("Built-in Tool Names:")}\n${TOOL_NAMES_HELP}`,
  );
}

const help = { printHelp };

export default help;
