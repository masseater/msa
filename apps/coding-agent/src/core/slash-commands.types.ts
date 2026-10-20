import type sourceInfoTypes from "./source-info.types.ts";

declare namespace slashCommandsTypes {
  type SlashCommandSource = "extension" | "prompt" | "skill";

  interface SlashCommandInfo {
    name: string;
    description?: string | undefined;
    source: SlashCommandSource;
    sourceInfo: sourceInfoTypes.SourceInfo;
  }

  interface BuiltinSlashCommand {
    name: string;
    description: string;
    argumentHint?: string;
    aliases?: readonly string[];
  }
}

export type { slashCommandsTypes as default };
