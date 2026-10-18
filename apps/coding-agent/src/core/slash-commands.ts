import { APP_NAME } from "../config.ts";
import { ACCOUNTS_DESCRIPTION } from "./accounts.ts";
import type { SourceInfo } from "./source-info.ts";

export type SlashCommandSource = "extension" | "prompt" | "skill";

export interface SlashCommandInfo {
  name: string;
  description?: string | undefined;
  source: SlashCommandSource;
  sourceInfo: SourceInfo;
}

export interface BuiltinSlashCommand {
  name: string;
  description: string;
  argumentHint?: string;
  /** Other names that run this command. */
  aliases?: readonly string[];
}

/** Named, grouped, and aliased as in Claude Code. */
export const BUILTIN_SLASH_COMMANDS: ReadonlyArray<BuiltinSlashCommand> = [
  { name: "help", description: "Show the available commands" },
  { name: "config", description: "Open settings", aliases: ["settings", "theme"] },
  {
    name: "model",
    description: "Select model (opens selector UI)",
    argumentHint: "<provider/model>",
  },
  {
    name: "effort",
    description: "Set thinking level",
    argumentHint: "<level>",
  },
  { name: "scoped-models", description: "Enable/disable models for Ctrl+P cycling" },
  { name: "login", description: "Configure provider authentication", argumentHint: "<provider>" },
  { name: "logout", description: "Remove provider authentication" },
  {
    name: "accounts",
    description: ACCOUNTS_DESCRIPTION,
    argumentHint: "[<kind> <action> <name>]",
  },
  { name: "clear", description: "Start a new session", aliases: ["new", "reset"] },
  { name: "resume", description: "Resume a different session", aliases: ["continue"] },
  {
    name: "rename",
    description: "Set session display name",
    argumentHint: "<name>",
  },
  {
    name: "status",
    description: "Show session info, usage, and cost",
    aliases: ["usage", "cost", "stats", "context"],
  },
  {
    name: "rewind",
    description: "Go back to an earlier point in the session tree",
    aliases: ["checkpoint", "undo"],
  },
  { name: "fork", description: "Create a new session from an earlier user message" },
  {
    name: "branch",
    description: "Duplicate the current session at the current position",
  },
  {
    name: "compact",
    description: "Manually compact the session context",
    argumentHint: "<instructions>",
  },
  {
    name: "goal",
    description: "Keep working until a condition is met; no argument shows status",
    argumentHint: "<condition>|clear",
  },
  { name: "init", description: "Write an AGENTS.md that describes this repository" },
  { name: "copy", description: "Copy last agent message to clipboard" },
  { name: "export", description: "Export session (HTML default, or specify path: .html/.jsonl)" },
  { name: "import", description: "Import and resume a session from a JSONL file" },
  { name: "share", description: "Share session via a GitHub gist" },
  {
    name: "bug",
    description: "Export a bug report as a zip archive",
    argumentHint: "<description>",
    aliases: ["feedback"],
  },
  { name: "trust", description: "Save project trust decision for future sessions" },
  {
    name: "memory",
    description: "Open the memory view, or manage long-term memory with an argument",
    argumentHint: "[list|search <query>|forget <id>|stats]",
  },
  { name: "sessions", description: "Show the sessions the orchestrator started" },
  {
    name: "reload",
    description: "Reload keybindings, extensions, skills, prompts, themes, and context files",
    aliases: ["reload-skills", "reload-plugins"],
  },
  { name: "keybindings", description: "Show all keyboard shortcuts" },
  { name: "release-notes", description: "Show changelog entries" },
  { name: "exit", description: `Exit ${APP_NAME}`, aliases: ["quit"] },
];

const BUILTIN_NAMES: ReadonlyMap<string, string> = new Map(
  BUILTIN_SLASH_COMMANDS.flatMap((command) => [
    [command.name, command.name] as const,
    ...(command.aliases ?? []).map((alias) => [alias, command.name] as const),
  ]),
);

/** Whether `name` (without the slash) is a built-in command or one of its aliases. */
export function isBuiltinSlashCommandName(name: string): boolean {
  return BUILTIN_NAMES.has(name);
}

/**
 * Rewrites a built-in command typed by one of its aliases to the command's own name, keeping its
 * arguments: `/quit` becomes `/exit`, `/cost` becomes `/status`. Other text is
 * returned unchanged.
 */
export function canonicalizeBuiltinSlashCommand(text: string): string {
  const typed = slashCommandName(text);
  if (typed === undefined) return text;
  const name = BUILTIN_NAMES.get(typed);
  return name === undefined ? text : `/${name}${text.slice(typed.length + 1)}`;
}

/** What `/init` sends: the model writes the repository's AGENTS.md. */
export const INIT_PROMPT =
  "Analyze this repository and write an AGENTS.md at its root for future sessions: the setup " +
  "commands, how to build, test, and lint, the layout of the code, and the conventions to follow. " +
  "Read package.json (or the equivalent), the build and test configuration, and AGENTS.md and " +
  "CLAUDE.md if they already exist. Keep it short and specific to this repository.";

/**
 * The `/help` text: built-in commands with their aliases, then the commands resources added. A
 * built-in command whose name an added command (a skill) took is left out.
 */
export function formatHelpMarkdown(
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
      row(command.name, aliases ? `${command.description} (${aliases})` : command.description),
    );
  }
  // Skill descriptions run to paragraphs; the first sentence is enough to pick one.
  for (const command of added) {
    lines.push(row(command.name, command.description?.split(/(?<=[.。])\s*|\n/u)[0]));
  }
  return lines.join("\n");
}

/** The command name at the start of `text` (`/name args` gives `name`), or undefined for other text. */
export function slashCommandName(text: string): string | undefined {
  if (!text.startsWith("/")) return undefined;
  const end = text.search(/\s/u);
  return end === -1 ? text.slice(1) : text.slice(1, end);
}

/**
 * The commands `/name` runs: a skill takes its name from any extension command or prompt template
 * of the same name, as a Claude Code skill does from a command file.
 */
export function withSkillCommands<T extends { name: string }>(
  commands: readonly T[],
  skills: readonly T[],
): T[] {
  const skillNames = new Set(skills.map((skill) => skill.name));
  return [...commands.filter((command) => !skillNames.has(command.name)), ...skills];
}
