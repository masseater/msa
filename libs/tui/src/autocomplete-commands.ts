import { Effect } from "effect";

import type {
  AutocompleteItem,
  AutocompleteSuggestions,
  SlashCommand,
} from "./autocomplete-types.ts";
import { fuzzyFilter } from "./fuzzy.ts";

export type CommandEntry = SlashCommand | AutocompleteItem;

interface CommandItem {
  name: string;
  label: string;
  description: string | undefined;
}

function commandName(command: CommandEntry): string {
  return "name" in command ? command.name : command.value;
}

function toCommandItem(command: CommandEntry): CommandItem {
  const name = commandName(command);
  const hint =
    "argumentHint" in command && command.argumentHint !== "" ? command.argumentHint : undefined;
  const desc = command.description ?? "";
  const fullDesc =
    hint !== undefined && hint !== "" ? (desc === "" ? hint : `${hint} — ${desc}`) : desc;
  return {
    name,
    label: name,
    description: fullDesc || undefined,
  };
}

function matchCommandItems(items: CommandItem[], prefix: string): CommandItem[] {
  const bareNameMatches = fuzzyFilter(items, prefix, (item) =>
    item.name.startsWith("skill:") ? item.name.slice("skill:".length) : item.name,
  );
  const bareNameMatchSet = new Set(bareNameMatches);
  const fullNameOnlyMatches = fuzzyFilter(
    items.filter((item) => item.name.startsWith("skill:") && !bareNameMatchSet.has(item)),
    prefix,
    (item) => item.name,
  );
  return [...bareNameMatches, ...fullNameOnlyMatches];
}

export interface CommandQuery {
  commands: readonly CommandEntry[];
  commandText: string;
}

export function getCommandNameSuggestions({
  commands,
  commandText,
}: CommandQuery): AutocompleteSuggestions | null {
  const filtered = matchCommandItems(commands.map(toCommandItem), commandText.slice(1)).map(
    (item) => {
      const suggestion: AutocompleteItem = { value: item.name, label: item.label };
      if (item.description !== undefined && item.description !== "")
        suggestion.description = item.description;
      return suggestion;
    },
  );

  if (filtered.length === 0) return null;

  return {
    items: filtered,
    prefix: commandText,
  };
}

export function getCommandArgumentSuggestions({
  commands,
  commandText,
}: CommandQuery): Effect.Effect<AutocompleteSuggestions | null> {
  const spaceIndex = commandText.indexOf(" ");
  const name = commandText.slice(1, spaceIndex);
  const argumentText = commandText.slice(spaceIndex + 1);

  const command = commands.find((candidate) => commandName(candidate) === name);
  if (
    command === undefined ||
    !("getArgumentCompletions" in command) ||
    command.getArgumentCompletions === undefined
  ) {
    return Effect.succeed(null);
  }
  const getArgumentCompletions = command.getArgumentCompletions.bind(command);

  return Effect.promise(() => Promise.resolve(getArgumentCompletions(argumentText))).pipe(
    Effect.map((argumentSuggestions) =>
      !Array.isArray(argumentSuggestions) || argumentSuggestions.length === 0
        ? null
        : { items: argumentSuggestions, prefix: argumentText },
    ),
  );
}
