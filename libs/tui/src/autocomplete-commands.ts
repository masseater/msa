import { Effect } from "effect";

import type autocompleteCommandsTypes from "./autocomplete-commands.types.ts";
import type autocompleteTypesModule from "./autocomplete-types.ts";
import fuzzy from "./fuzzy.ts";

const { fuzzyFilter } = fuzzy;

interface CommandItem {
  name: string;
  label: string;
  description: string | undefined;
}

function commandName(command: autocompleteCommandsTypes.CommandEntry): string {
  return "name" in command ? command.name : command.value;
}

function toCommandItem(command: autocompleteCommandsTypes.CommandEntry): CommandItem {
  const name = commandName(command);
  const hint =
    "argumentHint" in command && command.argumentHint !== "" ? command.argumentHint : undefined;
  const desc = command.description ?? "";
  const fullDesc =
    hint !== undefined && hint !== "" ? (desc === "" ? hint : `${hint} — ${desc}`) : desc;
  return {
    description: fullDesc || undefined,
    label: name,
    name,
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

function getCommandNameSuggestions({
  commands,
  commandText,
}: autocompleteCommandsTypes.CommandQuery): autocompleteTypesModule.AutocompleteSuggestions | null {
  const filtered = matchCommandItems(commands.map(toCommandItem), commandText.slice(1)).map(
    (item) => {
      const suggestion: autocompleteTypesModule.AutocompleteItem = {
        label: item.label,
        value: item.name,
      };
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

function getCommandArgumentSuggestions({
  commands,
  commandText,
}: autocompleteCommandsTypes.CommandQuery): Effect.Effect<autocompleteTypesModule.AutocompleteSuggestions | null> {
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

const autocompleteCommands = {
  getCommandArgumentSuggestions,
  getCommandNameSuggestions,
};

export default autocompleteCommands;
