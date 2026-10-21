import { dual } from "effect/Function";

function detectLineEnding(content: string): "\r\n" | "\n" {
  const crlfIdx = content.indexOf("\r\n");
  const lfIdx = content.indexOf("\n");
  if (lfIdx === -1) return "\n";
  if (crlfIdx === -1) return "\n";
  return crlfIdx < lfIdx ? "\r\n" : "\n";
}

function normalizeToLF(text: string): string {
  return text.replace(/\r\n/gu, "\n").replace(/\r/gu, "\n");
}

const restoreLineEndings: {
  (ending: "\r\n" | "\n"): (text: string) => string;
  (text: string, ending: "\r\n" | "\n"): string;
} = dual(2, (text: string, ending: "\r\n" | "\n"): string =>
  ending === "\r\n" ? text.replace(/\n/gu, "\r\n") : text,
);

function normalizeForFuzzyMatch(text: string): string {
  return text
    .normalize("NFKC")
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")
    .replace(/[\u2018\u2019\u201A\u201B]/gu, "'")
    .replace(/[\u201C\u201D\u201E\u201F]/gu, '"')
    .replace(/[\u2010\u2011\u2012\u2013\u2014\u2015\u2212]/gu, "-")
    .replace(/[\u00A0\u2002-\u200A\u202F\u205F\u3000]/gu, " ");
}

function splitLinesWithEndings(content: string): string[] {
  return content.match(/[^\n]*\n|[^\n]+/gu) ?? [];
}

const editText = {
  detectLineEnding,
  normalizeForFuzzyMatch,
  normalizeToLF,
  restoreLineEndings,
  splitLinesWithEndings,
};

export default editText;
