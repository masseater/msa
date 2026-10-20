const cjkBreakRegex =
  /[\p{Script_Extensions=Han}\p{Script_Extensions=Hiragana}\p{Script_Extensions=Katakana}\p{Script_Extensions=Hangul}\p{Script_Extensions=Bopomofo}]/u;

const cjkPunctuationRegex = new RegExp(
  `(?:(?=\\p{Punctuation})${cjkBreakRegex.source}|[，．：；！？（）［］｛｝“”‘’…—])`,
  "u",
);
const autocompleteSeparatorRegex = new RegExp(`(?:\\s|${cjkPunctuationRegex.source})`, "u");
const autocompleteBoundaryRegex = new RegExp(`(?:^|${autocompleteSeparatorRegex.source})`, "u");

const PUNCTUATION_REGEX = /[(){}[\]<>.,;:'"!?+\-=*/\\|&%^$#@~`]/u;

function isWhitespaceChar(char: string): boolean {
  return /\s/u.test(char);
}

function isPunctuationChar(char: string): boolean {
  return PUNCTUATION_REGEX.test(char);
}

const textBoundaries = {
  PUNCTUATION_REGEX,
  autocompleteBoundaryRegex,
  autocompleteSeparatorRegex,
  cjkBreakRegex,
  cjkPunctuationRegex,
  isPunctuationChar,
  isWhitespaceChar,
};

export default textBoundaries;
