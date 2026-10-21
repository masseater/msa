import { Effect } from "effect";

import autocompleteApply from "./autocomplete-apply.ts";
import autocompleteCommands from "./autocomplete-commands.ts";
import type autocompleteCommandsTypes from "./autocomplete-commands.types.ts";
import autocompleteFiles from "./autocomplete-files.ts";
import autocompleteFuzzyFiles from "./autocomplete-fuzzy-files.ts";
import autocompletePrefix from "./autocomplete-prefix.ts";
import type autocompleteTypesModule from "./autocomplete-types.ts";
import platform from "./platform.ts";
import type platformTypes from "./platform.types.ts";

const { platformRuntime } = platform;
const { applyAutocompleteCompletion } = autocompleteApply;
const { extractAtPrefix, extractForcedPathPrefix, extractPathPrefix, parsePathPrefix } =
  autocompletePrefix;
const { getCommandArgumentSuggestions, getCommandNameSuggestions } = autocompleteCommands;
const { getFuzzyFileSuggestions } = autocompleteFuzzyFiles;
const { getFileSuggestions } = autocompleteFiles;

export default class CombinedAutocompleteProvider
  implements autocompleteTypesModule.AutocompleteProvider
{
  private commands: autocompleteCommandsTypes.CommandEntry[];
  private basePath: string;
  private fdPath: string | null;

  constructor(
    commands: autocompleteCommandsTypes.CommandEntry[] = [],
    basePath: string,
    fdPath: string | null = null,
  ) {
    this.commands = commands;
    this.basePath = basePath;
    this.fdPath = fdPath;
  }

  getSuggestions(
    lines: string[],
    cursorLine: number,
    cursorCol: number,
    options: { signal: AbortSignal; force?: boolean },
  ): Promise<autocompleteTypesModule.AutocompleteSuggestions | null> {
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
    item: autocompleteTypesModule.AutocompleteItem,
    prefix: string,
  ): { lines: string[]; cursorLine: number; cursorCol: number } {
    return applyAutocompleteCompletion({ cursorCol, cursorLine, item, lines, prefix });
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
  ): Effect.Effect<
    autocompleteTypesModule.AutocompleteSuggestions | null,
    never,
    platformTypes.Platform
  > {
    const atPrefix = extractAtPrefix(textBeforeCursor);
    if (atPrefix !== null && atPrefix !== "") {
      return this.atPrefixSuggestions(atPrefix, options.signal);
    }

    const commandText = textBeforeCursor.trimStart();
    if (options.force !== true && commandText.startsWith("/")) {
      return commandText.includes(" ")
        ? getCommandArgumentSuggestions({ commandText, commands: this.commands })
        : Effect.succeed(getCommandNameSuggestions({ commandText, commands: this.commands }));
    }

    return this.pathSuggestions(textBeforeCursor, options.force ?? false);
  }

  private atPrefixSuggestions(
    atPrefix: string,
    signal: AbortSignal,
  ): Effect.Effect<
    autocompleteTypesModule.AutocompleteSuggestions | null,
    never,
    platformTypes.Platform
  > {
    const { rawPrefix, isQuotedPrefix } = parsePathPrefix(atPrefix);
    return getFuzzyFileSuggestions({
      basePath: this.basePath,
      fdPath: this.fdPath,
      isQuotedPrefix,
      query: rawPrefix,
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
  ): Effect.Effect<
    autocompleteTypesModule.AutocompleteSuggestions | null,
    never,
    platformTypes.Platform
  > {
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
