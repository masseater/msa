import { dual } from "effect/Function";

import type latexFormatTypes from "./latex-format.types.ts";
import latexTables from "./latex-tables.ts";

const { SUBSCRIPTS, SUPERSCRIPTS } = latexTables;

const NAMED_OPERATOR_START = "\u{f0004}";
const NAMED_OPERATOR_END = "\u{f0005}";
const NAMED_OPERATOR_LEFT_SPACING_PATTERN = /(?<=[\p{L}\p{N})\]}\u{f0001}])\u{f0004}/gu;
const NAMED_OPERATOR_RIGHT_SPACING_PATTERN = /\u{f0005}(?=[\p{L}\p{N}√\u{f0000}])/gu;

function replaceCharacters(
  value: string,
  replacements: Readonly<Record<string, string>>,
): string | undefined {
  let result = "";
  for (const character of value) {
    const replacement = replacements[character];
    if (replacement === undefined) {
      return undefined;
    }
    result += replacement;
  }
  return result;
}

function normalizeScriptValue(value: string): string {
  return value.trim().replace(/\s*([=+-])\s*/gu, "$1");
}

const formatUnicodeScript: {
  (value: string, kind: latexFormatTypes.ScriptKind): string | undefined;
  (kind: latexFormatTypes.ScriptKind): (value: string) => string | undefined;
} = dual(2, (value: string, kind: latexFormatTypes.ScriptKind): string | undefined =>
  replaceCharacters(normalizeScriptValue(value), kind === "sub" ? SUBSCRIPTS : SUPERSCRIPTS),
);

const formatScript: {
  (value: string, kind: latexFormatTypes.ScriptKind): string;
  (kind: latexFormatTypes.ScriptKind): (value: string) => string;
} = dual(2, (rawValue: string, kind: latexFormatTypes.ScriptKind): string => {
  const value = normalizeScriptValue(rawValue);
  const unicode = formatUnicodeScript(value, kind);
  if (unicode !== undefined) {
    return unicode;
  }

  const prefix = kind === "sub" ? "_" : "^";
  if (Array.from(value).length === 1 || (kind === "sub" && /^[A-Za-z]+$/u.test(value))) {
    return `${prefix}${value}`;
  }
  return `${prefix}(${value})`;
});

const formatFraction: {
  (numerator: string, denominator: string): string;
  (denominator: string): (numerator: string) => string;
} = dual(2, (rawNumerator: string, rawDenominator: string): string => {
  const numerator = rawNumerator.trim();
  const denominator = rawDenominator.trim();
  const simpleNumerator = /^[\p{L}\p{N}.]+$/u.test(numerator);
  const simpleDenominator =
    /^[\p{N}.]+$/u.test(denominator) || Array.from(denominator).length === 1;
  return `${simpleNumerator ? numerator : `(${numerator})`}/${simpleDenominator ? denominator : `(${denominator})`}`;
});

const formatRoot: {
  (value: string, symbol: string): string;
  (symbol: string): (value: string) => string;
} = dual(2, (rawValue: string, symbol: string): string => {
  const value = rawValue.trim();
  return /^[\p{L}\p{N}.]+$/u.test(value) ? `${symbol}${value}` : `${symbol}(${value})`;
});

function normalizeOutput(value: string): string {
  return value
    .replace(NAMED_OPERATOR_LEFT_SPACING_PATTERN, " ")
    .replaceAll(NAMED_OPERATOR_START, "")
    .replace(NAMED_OPERATOR_RIGHT_SPACING_PATTERN, " ")
    .replaceAll(NAMED_OPERATOR_END, "")
    .split("\n")
    .map((line) => line.replace(/[ \t]+/gu, " ").trim())
    .filter((line, index, lines) => line.length > 0 || (index > 0 && index < lines.length - 1))
    .join("\n")
    .trim();
}

const latexFormat = {
  NAMED_OPERATOR_END,
  NAMED_OPERATOR_START,
  formatFraction,
  formatRoot,
  formatScript,
  formatUnicodeScript,
  normalizeOutput,
};

export default latexFormat;
