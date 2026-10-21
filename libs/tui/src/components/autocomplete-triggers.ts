import textBoundaries from "../text-boundaries.ts";

const { autocompleteBoundaryRegex, autocompleteSeparatorRegex, isWhitespaceChar } = textBoundaries;

const ATTACHMENT_AUTOCOMPLETE_DEBOUNCE_MS = 20;

const DEFAULT_AUTOCOMPLETE_TRIGGER_CHARACTERS = ["@", "#"];

const unquotedAutocompleteSuffixRegex = new RegExp(
  `(?:(?!${autocompleteSeparatorRegex.source}).)*`,
  "u",
);

const autocompleteTokenStartSource = `${autocompleteBoundaryRegex.source}[([{<\`]*`;

function escapeCharacterClass(value: string): string {
  return value.replace(/[\\^$.*+?()[\]{}|-]/gu, "\\$&");
}

function buildTriggerPattern(triggerCharacters: string[]): RegExp {
  return new RegExp(
    `${autocompleteTokenStartSource}(?:@"[^"]*|[${triggerCharacters.map(escapeCharacterClass).join("")}]${unquotedAutocompleteSuffixRegex.source})$`,
    "u",
  );
}

function buildDebouncePattern(triggerCharacters: string[]): RegExp {
  const escapedWithoutAt = triggerCharacters
    .filter((character) => character !== "@")
    .map(escapeCharacterClass);
  return new RegExp(
    `${autocompleteTokenStartSource}(?:@(?:"[^"]*|${unquotedAutocompleteSuffixRegex.source})|[${escapedWithoutAt.join("")}]${unquotedAutocompleteSuffixRegex.source})$`,
    "u",
  );
}

export default class AutocompleteTriggers {
  private characters = [...DEFAULT_AUTOCOMPLETE_TRIGGER_CHARACTERS];
  private triggerPattern = buildTriggerPattern(this.characters);
  private debouncePattern = buildDebouncePattern(this.characters);

  set(triggerCharacters: readonly string[]): void {
    const next = [...DEFAULT_AUTOCOMPLETE_TRIGGER_CHARACTERS];
    for (const character of triggerCharacters) {
      if (
        character.length !== 1 ||
        character === "/" ||
        isWhitespaceChar(character) ||
        next.includes(character)
      ) {
        continue;
      }
      next.push(character);
    }
    this.characters = next;
    this.triggerPattern = buildTriggerPattern(next);
    this.debouncePattern = buildDebouncePattern(next);
  }

  isTriggerCharacter(character: string): boolean {
    return this.characters.includes(character);
  }

  matches(textBeforeCursor: string): boolean {
    return this.triggerPattern.test(textBeforeCursor);
  }

  debounceMs(textBeforeCursor: string): number {
    return this.debouncePattern.test(textBeforeCursor) ? ATTACHMENT_AUTOCOMPLETE_DEBOUNCE_MS : 0;
  }
}
