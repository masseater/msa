import type autocompletePrefixTypes from "./autocomplete-prefix.types.ts";
import textBoundaries from "./text-boundaries.ts";

const { autocompleteBoundaryRegex, autocompleteSeparatorRegex } = textBoundaries;

const PATH_DELIMITERS = new Set([" ", "\t", '"', "'", "="]);
const tokenStartRegex = new RegExp(`${autocompleteBoundaryRegex.source}$`, "u");
const PATH_WRAPPERS: Record<string, string> = { "(": ")", "<": ">", "[": "]", "`": "`", "{": "}" };

function toDisplayPath(value: string): string {
  return value.replace(/\\/gu, "/");
}

function findLastDelimiter(text: string): number {
  let lastDelimiter = -1;
  let index = 0;
  for (const character of text) {
    index += character.length;
    if (PATH_DELIMITERS.has(character) || autocompleteSeparatorRegex.test(character)) {
      lastDelimiter = index - 1;
    }
  }
  return lastDelimiter;
}

function stripLeadingWrappers(token: string): string {
  let result = token;
  while (result.length > 0) {
    const closer = PATH_WRAPPERS[result[0]!];
    if (closer === undefined || closer === "" || result.includes(closer, 1)) {
      break;
    }
    result = result.slice(1);
  }
  return result;
}

function findUnclosedQuoteStart(text: string): number | null {
  let inQuotes = false;
  let quoteStart = -1;

  for (let i = 0; i < text.length; i += 1) {
    if (text[i] === '"') {
      inQuotes = !inQuotes;
      if (inQuotes) {
        quoteStart = i;
      }
    }
  }

  return inQuotes ? quoteStart : null;
}

function isTokenStart(text: string, index: number): boolean {
  let start = index;
  while (start > 0 && PATH_WRAPPERS[text[start - 1]!] !== undefined) {
    start -= 1;
  }
  return PATH_DELIMITERS.has(text[start - 1] ?? "") || tokenStartRegex.test(text.slice(0, start));
}

function extractQuotedPrefix(text: string): string | null {
  const quoteStart = findUnclosedQuoteStart(text);
  if (quoteStart === null) {
    return null;
  }

  if (quoteStart > 0 && text[quoteStart - 1] === "@") {
    if (!isTokenStart(text, quoteStart - 1)) {
      return null;
    }
    return text.slice(quoteStart - 1);
  }

  if (!isTokenStart(text, quoteStart)) {
    return null;
  }

  return text.slice(quoteStart);
}

function lastToken(text: string): string {
  const lastDelimiterIndex = findLastDelimiter(text);
  return stripLeadingWrappers(
    lastDelimiterIndex === -1 ? text : text.slice(lastDelimiterIndex + 1),
  );
}

function parsePathPrefix(prefix: string): autocompletePrefixTypes.ParsedPathPrefix {
  if (prefix.startsWith('@"')) {
    return { isAtPrefix: true, isQuotedPrefix: true, rawPrefix: prefix.slice(2) };
  }
  if (prefix.startsWith('"')) {
    return { isAtPrefix: false, isQuotedPrefix: true, rawPrefix: prefix.slice(1) };
  }
  if (prefix.startsWith("@")) {
    return { isAtPrefix: true, isQuotedPrefix: false, rawPrefix: prefix.slice(1) };
  }
  return { isAtPrefix: false, isQuotedPrefix: false, rawPrefix: prefix };
}

function buildCompletionValue(input: autocompletePrefixTypes.CompletionValueInput): string {
  const needsQuotes = input.isQuotedPrefix || autocompleteSeparatorRegex.test(input.path);
  const prefix = input.isAtPrefix ? "@" : "";

  if (!needsQuotes) {
    return `${prefix}${input.path}`;
  }

  const openQuote = `${prefix}"`;
  const closeQuote = '"';
  return `${openQuote}${input.path}${closeQuote}`;
}

function extractAtPrefix(text: string): string | null {
  const quotedPrefix = extractQuotedPrefix(text);
  if (quotedPrefix?.startsWith('@"') === true) {
    return quotedPrefix;
  }

  const token = lastToken(text);
  if (token.startsWith("@")) {
    return token;
  }

  return null;
}

function extractPathPrefix(text: string): string | null {
  const quotedPrefix = extractQuotedPrefix(text);
  if (quotedPrefix !== null && quotedPrefix !== "") {
    return quotedPrefix;
  }

  const pathPrefix = lastToken(text);

  if (pathPrefix.includes("/") || pathPrefix.startsWith(".") || pathPrefix.startsWith("~/")) {
    return pathPrefix;
  }

  if (pathPrefix === "" && text !== "" && tokenStartRegex.test(text)) {
    return pathPrefix;
  }

  return null;
}

function extractForcedPathPrefix(text: string): string {
  const quotedPrefix = extractQuotedPrefix(text);
  if (quotedPrefix !== null && quotedPrefix !== "") {
    return quotedPrefix;
  }
  return lastToken(text);
}

const autocompletePrefix = {
  buildCompletionValue,
  extractAtPrefix,
  extractForcedPathPrefix,
  extractPathPrefix,
  parsePathPrefix,
  toDisplayPath,
};

export default autocompletePrefix;
