import { dual } from "effect/Function";
import { eastAsianWidth } from "get-east-asian-width";

import type utilsTypes from "./utils.types.ts";

const graphemeSegmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
const wordSegmenter = new Intl.Segmenter(undefined, { granularity: "word" });

function getGraphemeSegmenter(): Intl.Segmenter {
  return graphemeSegmenter;
}

function getWordSegmenter(): Intl.Segmenter {
  return wordSegmenter;
}

function couldBeEmoji(segment: string): boolean {
  const cp = segment.codePointAt(0)!;
  return (
    (cp >= 0x1f000 && cp <= 0x1fbff) ||
    (cp >= 0x2300 && cp <= 0x23ff) ||
    (cp >= 0x2600 && cp <= 0x27bf) ||
    (cp >= 0x2b50 && cp <= 0x2b55) ||
    segment.includes("\uFE0F") ||
    segment.length > 2
  );
}

const zeroWidthRegex =
  /^(?:\p{Default_Ignorable_Code_Point}|\p{Control}|\p{Mark}|\p{Surrogate})+$/v;
const leadingNonPrintingRegex =
  /^[\p{Default_Ignorable_Code_Point}\p{Control}\p{Format}\p{Mark}\p{Surrogate}]+/v;
const nonPrintingCharRegex =
  /^(?:\p{Default_Ignorable_Code_Point}|\p{Control}|\p{Format}|\p{Mark}|\p{Surrogate})$/v;
const markCharRegex = /^\p{Mark}$/v;
const terminalSpacingMarkRegex =
  /^(?:[\p{Spacing_Mark}--[\u1734\u302E\u302F]]|[\u065F\u0F7F\u102B\u102C\u1031\u1033-\u1035\u1038\u103A-\u103E])+$/v;
const rgiEmojiRegex = /^\p{RGI_Emoji}$/v;

const WIDTH_CACHE_SIZE = 512;
const widthCache = new Map<string, number>();

function isPrintableAscii(str: string): boolean {
  for (let i = 0; i < str.length; i++) {
    const code = str.charCodeAt(i);
    if (code < 0x20 || code > 0x7e) {
      return false;
    }
  }
  return true;
}

function trailingCharsWidth(chars: readonly string[]): number {
  let width = 0;
  let followsMark = false;
  for (const char of chars) {
    if (terminalSpacingMarkRegex.test(char)) {
      width += 1;
      followsMark = false;
    } else if (markCharRegex.test(char)) {
      followsMark = true;
    } else if (!nonPrintingCharRegex.test(char)) {
      const c = char.codePointAt(0)!;
      if (followsMark || (c >= 0xff00 && c <= 0xffef)) {
        width += eastAsianWidth(c);
      } else if (c === 0x0e33 || c === 0x0eb3) {
        width += 1;
      }
      followsMark = false;
    }
  }
  return width;
}

function graphemeWidth(segment: string): number {
  if (segment.length === 1) {
    const code = segment.charCodeAt(0);
    if (code >= 0x20 && code <= 0x7e) return 1;
    if (code === 0x09) return 3;
  }

  if (terminalSpacingMarkRegex.test(segment)) {
    return [...segment].length;
  }

  if (zeroWidthRegex.test(segment)) {
    return 0;
  }

  if (couldBeEmoji(segment) && rgiEmojiRegex.test(segment)) {
    return 2;
  }

  const base = segment.replace(leadingNonPrintingRegex, "");
  const cp = base.codePointAt(0);
  if (cp === undefined) {
    return 0;
  }

  if (cp >= 0x1f1e6 && cp <= 0x1f1ff) {
    return 2;
  }

  return eastAsianWidth(cp) + trailingCharsWidth([...base].slice(1));
}

function* textUnits(text: string): Generator<utilsTypes.TextUnit> {
  let i = 0;
  while (i < text.length) {
    const ansi = extractAnsiCode(text, i);
    if (ansi !== null) {
      yield { ansi: true, text: ansi.code, width: 0 };
      i += ansi.length;
      continue;
    }
    let end = text.indexOf("\x1b", i);
    while (end !== -1 && ansiCodeLength(text, end) === 0) end = text.indexOf("\x1b", end + 1);
    if (end === -1) end = text.length;
    for (const { segment } of graphemeSegmenter.segment(text.slice(i, end))) {
      yield { ansi: false, text: segment, width: graphemeWidth(segment) };
    }
    i = end;
  }
}

function stripAnsiCodes(text: string): string {
  let escapeIndex = text.indexOf("\x1b");
  if (escapeIndex === -1) return text;
  let stripped = "";
  let copyFrom = 0;
  while (escapeIndex !== -1) {
    const length = ansiCodeLength(text, escapeIndex);
    if (length > 0) {
      stripped += text.slice(copyFrom, escapeIndex);
      escapeIndex += length;
      copyFrom = escapeIndex;
    } else {
      escapeIndex++;
    }
    escapeIndex = text.indexOf("\x1b", escapeIndex);
  }
  return stripped + text.slice(copyFrom);
}

function rememberWidth(str: string, width: number): void {
  if (widthCache.size >= WIDTH_CACHE_SIZE) {
    const firstKey = widthCache.keys().next().value;
    if (firstKey !== undefined) {
      widthCache.delete(firstKey);
    }
  }
  widthCache.set(str, width);
}

function visibleWidth(str: string): number {
  if (str.length === 0) {
    return 0;
  }

  const asciiWidth = asciiVisibleWidth(str);
  if (asciiWidth !== -1) {
    return asciiWidth;
  }

  const cached = widthCache.get(str);
  if (cached !== undefined) {
    return cached;
  }

  const clean = stripAnsiCodes(str.includes("\t") ? str.replace(/\t/gu, "   ") : str);
  let width = 0;
  for (const { segment } of graphemeSegmenter.segment(clean)) {
    width += graphemeWidth(segment);
  }
  rememberWidth(str, width);
  return width;
}

function stripTerminalSequences(str: string): string {
  if (!str.includes("\x1b")) return str;
  let result = "";
  let i = 0;
  while (i < str.length) {
    const ansi = extractAnsiCode(str, i);
    if (ansi !== null) {
      i += ansi.length;
      continue;
    }
    result += str[i];
    i++;
  }
  return result;
}

const THAI_LAO_AM_REGEX = /[\u0e33\u0eb3]/u;
const THAI_LAO_AM_GLOBAL_REGEX = /[\u0e33\u0eb3]/gu;

function normalizeTerminalOutput(str: string): string {
  let normalized = str;
  if (THAI_LAO_AM_REGEX.test(normalized)) {
    normalized = normalized.replace(THAI_LAO_AM_GLOBAL_REGEX, (char) =>
      char === "\u0e33" ? "\u0e4d\u0e32" : "\u0ecd\u0eb2",
    );
  }
  if (!normalized.includes("\t")) return normalized;

  let result = "";
  let i = 0;
  while (i < normalized.length) {
    const ansi = extractAnsiCode(normalized, i);
    if (ansi !== null) {
      result += ansi.code;
      i += ansi.length;
      continue;
    }
    result += normalized[i] === "\t" ? "   " : normalized[i];
    i++;
  }
  return result;
}

const extractAnsiCode: {
  (str: string, pos: number): { code: string; length: number } | null;
  (pos: number): (str: string) => { code: string; length: number } | null;
} = dual(2, (str: string, pos: number): { code: string; length: number } | null => {
  const length = ansiCodeLength(str, pos);
  return length > 0 ? { code: str.substring(pos, pos + length), length } : null;
});

function asciiVisibleWidth(str: string): number {
  let width = 0;
  let i = 0;
  while (i < str.length) {
    const code = str.charCodeAt(i);
    if (code >= 0x20 && code <= 0x7e) {
      width++;
      i++;
    } else if (code === 0x09) {
      width += 3;
      i++;
    } else if (code === 0x1b) {
      const length = ansiCodeLength(str, i);
      if (length === 0) return -1;
      i += length;
    } else {
      return -1;
    }
  }
  return width;
}

const ansiCodeLength: {
  (str: string, pos: number): number;
  (pos: number): (str: string) => number;
} = dual(2, (str: string, pos: number): number => {
  if (pos >= str.length || str.charCodeAt(pos) !== 0x1b) return 0;

  const next = str[pos + 1];

  if (next === "[") {
    for (let j = pos + 2; j < str.length; j++) {
      const c = str.charCodeAt(j);
      if (c === 0x6d || c === 0x47 || c === 0x4b || c === 0x48 || c === 0x4a) return j + 1 - pos;
    }
    return 0;
  }

  if (next === "]" || next === "_") {
    for (let j = pos + 2; j < str.length; j++) {
      const c = str.charCodeAt(j);
      if (c === 0x07) return j + 1 - pos;
      if (c === 0x1b && str[j + 1] === "\\") return j + 2 - pos;
    }
    return 0;
  }

  return 0;
});

function flattenLines(lines: readonly string[]): void {
  for (const line of lines) Number(line);
}

const utils = {
  ansiCodeLength,
  extractAnsiCode,
  flattenLines,
  getGraphemeSegmenter,
  getWordSegmenter,
  isPrintableAscii,
  normalizeTerminalOutput,
  stripTerminalSequences,
  textUnits,
  visibleWidth,
};

export default utils;
