import config from "../config.ts";
import accounts from "./accounts.ts";
import type slashCommandsTypes from "./slash-commands.types.ts";

const { ACCOUNTS_DESCRIPTION } = accounts;
const { APP_NAME } = config;

const BUILTIN_SLASH_COMMANDS: ReadonlyArray<slashCommandsTypes.BuiltinSlashCommand> = [
  { description: "Show the available commands", name: "help" },
  { aliases: ["settings", "theme"], description: "Open settings", name: "config" },
  {
    argumentHint: "<provider/model>|upgrade",
    description: "Select model (opens selector UI)",
    name: "model",
  },
  {
    argumentHint: "<level>",
    description: "Set thinking level",
    name: "effort",
  },
  { description: "Enable/disable models for Ctrl+P cycling", name: "scoped-models" },
  { argumentHint: "<provider>", description: "Configure provider authentication", name: "login" },
  { description: "Remove provider authentication", name: "logout" },
  {
    argumentHint: "[<kind> <action> <name>]",
    description: ACCOUNTS_DESCRIPTION,
    name: "accounts",
  },
  { aliases: ["new", "reset"], description: "Start a new session", name: "clear" },
  { aliases: ["continue"], description: "Resume a different session", name: "resume" },
  {
    argumentHint: "<name>",
    description: "Set session display name",
    name: "rename",
  },
  {
    aliases: ["usage", "cost", "stats", "context"],
    description: "Show session info, usage, and cost",
    name: "status",
  },
  {
    aliases: ["checkpoint", "undo"],
    description: "Go back to an earlier point in the session tree",
    name: "rewind",
  },
  { description: "Create a new session from an earlier user message", name: "fork" },
  {
    description: "Duplicate the current session at the current position",
    name: "branch",
  },
  {
    argumentHint: "<instructions>",
    description: "Manually compact the session context",
    name: "compact",
  },
  {
    argumentHint: "<condition>|clear",
    description: "Keep working until a condition is met; no argument shows status",
    name: "goal",
  },
  {
    argumentHint: "<question>",
    description: "Ask a question; the model can only answer, not change anything",
    name: "ask",
  },
  { description: "Write an AGENTS.md that describes this repository", name: "init" },
  { description: "Copy last agent message to clipboard", name: "copy" },
  { description: "Export session (HTML default, or specify path: .html/.jsonl)", name: "export" },
  { description: "Import and resume a session from a JSONL file", name: "import" },
  { description: "Share session via a GitHub gist", name: "share" },
  {
    aliases: ["feedback"],
    argumentHint: "<description>",
    description: "Export a bug report as a zip archive",
    name: "bug",
  },
  { description: "Save project trust decision for future sessions", name: "trust" },
  {
    argumentHint: "[request]",
    description: "Open the sepiace memory view, or send sepiace a request such as forget X",
    name: "memory",
  },
  {
    argumentHint: "[words]",
    description: "Search past sessions and orchestrator threads, and read on from a match",
    name: "search",
  },
  { aliases: ["threads"], description: "Show the task DAG the orchestrator runs", name: "tasks" },
  {
    argumentHint: "[path]",
    description: "Write the orchestrator's state to a file the next session resumes from",
    name: "handoff",
  },
  {
    aliases: ["reload-skills", "reload-plugins"],
    description: "Reload keybindings, extensions, skills, prompts, themes, and context files",
    name: "reload",
  },
  { description: "Show all keyboard shortcuts", name: "keybindings" },
  { description: "Show changelog entries", name: "release-notes" },
  { aliases: ["quit"], description: `Exit ${APP_NAME}`, name: "exit" },
];

const BUILTIN_NAMES: ReadonlyMap<string, string> = new Map(
  BUILTIN_SLASH_COMMANDS.flatMap((command) => [
    [command.name, command.name] as const,
    ...(command.aliases ?? []).map((alias) => [alias, command.name] as const),
  ]),
);

function isBuiltinSlashCommandName(name: string): boolean {
  return BUILTIN_NAMES.has(name);
}

function canonicalizeBuiltinSlashCommand(text: string): string {
  const typed = slashCommandName(text);
  if (typed === undefined) return text;
  const name = BUILTIN_NAMES.get(typed);
  return name === undefined ? text : `/${name}${text.slice(typed.length + 1)}`;
}

function parseHandoffCommand(text: string): { path: string } | undefined {
  const match = /^\/handoff(?:\s+([\s\S]*))?$/u.exec(text.trim());
  return match === null ? undefined : { path: (match[1] ?? "").trim() };
}

function handoffPrompt(path: string): string {
  return [
    "Hand this orchestrator over to the next msa session. Call the `handoff` tool once.",
    "Write `premise` (what the next session must take as given), `goals` (the goal states in dependency order), and `donts` (what must not be started, and why) from this conversation. The tool fills in everything else.",
    path === "" ? "" : `Pass path: ${JSON.stringify(path)}.`,
    "When it returns, reply with its result exactly as returned and nothing else.",
  ]
    .filter(Boolean)
    .join("\n");
}

const INIT_PROMPT =
  "Analyze this repository and write an AGENTS.md at its root for future sessions: the setup " +
  "commands, how to build, test, and lint, the layout of the code, and the conventions to follow. " +
  "Read package.json (or the equivalent), the build and test configuration, and AGENTS.md and " +
  "CLAUDE.md if they already exist. Keep it short and specific to this repository.";

function formatHelpMarkdown(
  added: ReadonlyArray<{ name: string; description?: string | undefined }>,
): string {
  const row = (name: string, description = "") =>
    `| \`/${name}\` | ${description.replaceAll("|", "\\|")} |`;
  const lines = ["| Command | Description |", "| --- | --- |"];
  const taken = new Set(added.map((command) => command.name));
  for (const command of BUILTIN_SLASH_COMMANDS) {
    if (taken.has(command.name)) continue;
    const aliases = command.aliases?.map((alias) => `\`/${alias}\``).join(", ");
    lines.push(
      row(
        command.name,
        aliases !== undefined && aliases !== ""
          ? `${command.description} (${aliases})`
          : command.description,
      ),
    );
  }
  for (const command of added) {
    lines.push(row(command.name, command.description?.split(/(?<=[.。])\s*|\n/u)[0]));
  }
  return lines.join("\n");
}

function slashCommandName(text: string): string | undefined {
  if (!text.startsWith("/")) return undefined;
  const end = text.search(/\s/u);
  return end === -1 ? text.slice(1) : text.slice(1, end);
}

function withSkillCommands<T extends { name: string }>(
  commands: readonly T[],
  skills: readonly T[],
): T[] {
  const skillNames = new Set(skills.map((skill) => skill.name));
  return [...commands.filter((command) => !skillNames.has(command.name)), ...skills];
}

const slashCommands = {
  BUILTIN_SLASH_COMMANDS,
  INIT_PROMPT,
  canonicalizeBuiltinSlashCommand,
  formatHelpMarkdown,
  handoffPrompt,
  isBuiltinSlashCommandName,
  parseHandoffCommand,
  slashCommandName,
  withSkillCommands,
};

export default slashCommands;
