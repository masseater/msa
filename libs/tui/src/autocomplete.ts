import { Effect } from "effect";

import { applyAutocompleteCompletion } from "./autocomplete-apply.ts";
import {
  type CommandEntry,
  getCommandArgumentSuggestions,
  getCommandNameSuggestions,
} from "./autocomplete-commands.ts";
import { getFileSuggestions } from "./autocomplete-files.ts";
import { getFuzzyFileSuggestions } from "./autocomplete-fuzzy-files.ts";
import {
  extractAtPrefix,
  extractForcedPathPrefix,
  extractPathPrefix,
  parsePathPrefix,
} from "./autocomplete-prefix.ts";
import type {
  AutocompleteItem,
  AutocompleteProvider,
  AutocompleteSuggestions,
} from "./autocomplete-types.ts";
import { type Platform, platformRuntime } from "./platform.ts";

export type {
  AutocompleteItem,
  AutocompleteProvider,
  AutocompleteSuggestions,
  SlashCommand,
} from "./autocomplete-types.ts";

export class CombinedAutocompleteProvider implements AutocompleteProvider {
  private commands: CommandEntry[];
  private basePath: string;
  private fdPath: string | null;

  constructor(commands: CommandEntry[] = [], basePath: string, fdPath: string | null = null) {
    this.commands = commands;
    this.basePath = basePath;
    this.fdPath = fdPath;
  }

  getSuggestions(
    lines: string[],
    cursorLine: number,
    cursorCol: number,
    options: { signal: AbortSignal; force?: boolean },
  ): Promise<AutocompleteSuggestions | null> {
    return platformRuntime.runPromise(
      Effect.suspend(() =>
        this.suggestionsFor((lines[cursorLine] ?? "").slice(0, cursorCol), options),
      ),
    );
  }

  applyCompletion(
    lines: string[],
    cursorLine: number,
    cursorCol: number,
    item: AutocompleteItem,
    prefix: string,
  ): { lines: string[]; cursorLine: number; cursorCol: number } {
    return applyAutocompleteCompletion({ lines, cursorLine, cursorCol, item, prefix });
  }

  shouldTriggerFileCompletion(lines: string[], cursorLine: number, cursorCol: number): boolean {
    const currentLine = lines[cursorLine] ?? "";
    const textBeforeCursor = currentLine.slice(0, cursorCol);

    if (textBeforeCursor.trim().startsWith("/") && !textBeforeCursor.trim().includes(" ")) {
      return false;
    }

    return true;
  }

  private suggestionsFor(
    textBeforeCursor: string,
    options: { signal: AbortSignal; force?: boolean },
  ): Effect.Effect<AutocompleteSuggestions | null, never, Platform> {
    const atPrefix = extractAtPrefix(textBeforeCursor);
    if (atPrefix !== null && atPrefix !== "") {
      return this.atPrefixSuggestions(atPrefix, options.signal);
    }

    const commandText = textBeforeCursor.trimStart();
    if (options.force !== true && commandText.startsWith("/")) {
      return commandText.includes(" ")
        ? getCommandArgumentSuggestions({ commands: this.commands, commandText })
        : Effect.succeed(getCommandNameSuggestions({ commands: this.commands, commandText }));
    }

    return this.pathSuggestions(textBeforeCursor, options.force ?? false);
  }

  private atPrefixSuggestions(
    atPrefix: string,
    signal: AbortSignal,
  ): Effect.Effect<AutocompleteSuggestions | null, never, Platform> {
    const { rawPrefix, isQuotedPrefix } = parsePathPrefix(atPrefix);
    return getFuzzyFileSuggestions({
      basePath: this.basePath,
      fdPath: this.fdPath,
      query: rawPrefix,
      isQuotedPrefix,
      signal,
    }).pipe(
      Effect.map((suggestions) =>
        suggestions.length === 0 ? null : { items: suggestions, prefix: atPrefix },
      ),
    );
  }

  private pathSuggestions(
    textBeforeCursor: string,
    force: boolean,
  ): Effect.Effect<AutocompleteSuggestions | null, never, Platform> {
    const pathMatch = force
      ? extractForcedPathPrefix(textBeforeCursor)
      : extractPathPrefix(textBeforeCursor);
    if (pathMatch === null) {
      return Effect.succeed(null);
    }

    return getFileSuggestions({ basePath: this.basePath, prefix: pathMatch }).pipe(
      Effect.map((suggestions) =>
        suggestions.length === 0 ? null : { items: suggestions, prefix: pathMatch },
      ),
    );
  }
}
