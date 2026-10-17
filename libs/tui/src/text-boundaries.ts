export const cjkBreakRegex =
  /[\p{Script_Extensions=Han}\p{Script_Extensions=Hiragana}\p{Script_Extensions=Katakana}\p{Script_Extensions=Hangul}\p{Script_Extensions=Bopomofo}]/u;

export const cjkPunctuationRegex = new RegExp(
  `(?:(?=\\p{Punctuation})${cjkBreakRegex.source}|[，．：；！？（）［］｛｝“”‘’…—])`,
  "u",
);
export const autocompleteSeparatorRegex = new RegExp(`(?:\\s|${cjkPunctuationRegex.source})`, "u");
export const autocompleteBoundaryRegex = new RegExp(
  `(?:^|${autocompleteSeparatorRegex.source})`,
  "u",
);

export const PUNCTUATION_REGEX = /[(){}[\]<>.,;:'"!?+\-=*/\\|&%^$#@~`]/u;

export function isWhitespaceChar(char: string): boolean {
  return /\s/u.test(char);
}

export function isPunctuationChar(char: string): boolean {
  return PUNCTUATION_REGEX.test(char);
}
