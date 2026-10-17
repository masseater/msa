import { APP_NAME } from "../config.ts";
import type { SourceInfo } from "./source-info.ts";

export type SlashCommandSource = "extension" | "prompt" | "skill";

export interface SlashCommandInfo {
  name: string;
  description?: string;
  source: SlashCommandSource;
  sourceInfo: SourceInfo;
}

export interface BuiltinSlashCommand {
  name: string;
  description: string;
  argumentHint?: string;
}

export const BUILTIN_SLASH_COMMANDS: ReadonlyArray<BuiltinSlashCommand> = [
  { name: "settings", description: "Open settings menu" },
  {
    name: "model",
    description: "Select model (opens selector UI)",
    argumentHint: "<provider/model>",
  },
  { name: "tree", description: "Navigate session tree (switch branches)" },
  { name: "thinking", description: "Set thinking level", argumentHint: "<level>" },
  { name: "scoped-models", description: "Enable/disable models for Ctrl+P cycling" },
  { name: "export", description: "Export session (HTML default, or specify path: .html/.jsonl)" },
  { name: "import", description: "Import and resume a session from a JSONL file" },
  { name: "share", description: "Share session via a Radius artifact or a GitHub gist" },
  { name: "bug", description: "Report a bug to the msa developers", argumentHint: "<description>" },
  { name: "copy", description: "Copy last agent message to clipboard" },
  { name: "name", description: "Set session display name" },
  { name: "session", description: "Show session info and stats" },
  { name: "changelog", description: "Show changelog entries" },
  { name: "hotkeys", description: "Show all keyboard shortcuts" },
  { name: "fork", description: "Create a new fork from a previous user message" },
  { name: "clone", description: "Duplicate the current session at the current position" },
  { name: "trust", description: "Save project trust decision for future sessions" },
  { name: "login", description: "Configure provider authentication", argumentHint: "<provider>" },
  { name: "logout", description: "Remove provider authentication" },
  { name: "new", description: "Start a new session" },
  { name: "compact", description: "Manually compact the session context" },
  {
    name: "goal",
    description: "Keep working until a condition is met; no argument shows status",
    argumentHint: "<condition>|clear",
  },
  {
    name: "memory",
    description: "Open the memory view, or manage long-term memory with an argument",
    argumentHint: "[list|search <query>|forget <id>|stats]",
  },
  { name: "resume", description: "Resume a different session" },
  { name: "sessions", description: "Show the sessions the orchestrator started" },
  {
    name: "reload",
    description: "Reload keybindings, extensions, skills, prompts, themes, and context files",
  },
  { name: "quit", description: `Quit ${APP_NAME}` },
];
