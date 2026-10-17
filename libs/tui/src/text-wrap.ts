import { dual } from "effect/Function";

import { AnsiCodeTracker, updateTrackerFromText } from "./ansi-tracker.ts";
import { cjkBreakRegex } from "./text-boundaries.ts";
import {
  ansiCodeLength,
  extractAnsiCode,
  getGraphemeSegmenter,
  isPrintableAscii,
  textUnits,
  visibleWidth,
} from "./utils.ts";

interface TokenState {
  tokens: string[];
  current: string;
  pendingAnsi: string;
  currentKind: "space" | "word" | null;
}

interface WrapState {
  wrapped: string[];
  line: string;
  lineWidth: number;
  readonly tracker: AnsiCodeTracker;
  readonly width: number;
}

function* graphemeSegments(text: string): Generator<string> {
  for (const { segment } of getGraphemeSegmenter().segment(text)) yield segment;
}

function flushToken(state: TokenState): void {
  if (state.current === "") {
    return;
  }
  state.tokens.push(state.current);
  state.current = "";
  state.currentKind = null;
}

function pushTokenSegment(state: TokenState, segment: string, ascii: boolean): void {
  const segmentIsSpace = segment === " ";
  if (!ascii && !segmentIsSpace && cjkBreakRegex.test(segment)) {
    flushToken(state);
    state.tokens.push(state.pendingAnsi + segment);
    state.pendingAnsi = "";
    return;
  }

  const segmentKind = segmentIsSpace ? "space" : "word";
  if (state.current !== "" && state.currentKind !== segmentKind) {
    flushToken(state);
  }
  state.current += state.pendingAnsi;
  state.pendingAnsi = "";
  state.currentKind = segmentKind;
  state.current += segment;
}

function finishTokens(state: TokenState): string[] {
  if (state.pendingAnsi !== "") {
    if (state.current !== "") {
      state.current += state.pendingAnsi;
    } else if (state.tokens.length > 0) {
      state.tokens[state.tokens.length - 1] += state.pendingAnsi;
    } else {
      state.current = state.pendingAnsi;
    }
  }
  if (state.current !== "") {
    state.tokens.push(state.current);
  }
  return state.tokens;
}

function nextAnsiStart(text: string, from: number): number {
  let end = text.indexOf("\x1b", from + 1);
  while (end !== -1 && ansiCodeLength(text, end) === 0) {
    end = text.indexOf("\x1b", end + 1);
  }
  return end === -1 ? text.length : end;
}

function splitIntoTokensWithAnsi(text: string): string[] {
  const state: TokenState = { tokens: [], current: "", pendingAnsi: "", currentKind: null };
  let i = 0;
  while (i < text.length) {
    const ansiResult = extractAnsiCode(text, i);
    if (ansiResult !== null) {
      state.pendingAnsi += ansiResult.code;
      i += ansiResult.length;
      continue;
    }
    const end = nextAnsiStart(text, i);
    const chunk = text.slice(i, end);
    const ascii = isPrintableAscii(chunk);
    for (const segment of ascii ? chunk : graphemeSegments(chunk)) {
      pushTokenSegment(state, segment, ascii);
    }
    i = end;
  }
  return finishTokens(state);
}

function withLineEndReset(line: string, tracker: AnsiCodeTracker): string {
  return line + tracker.getLineEndReset();
}

function breakLongWord(word: string, width: number, tracker: AnsiCodeTracker): string[] {
  const lines: string[] = [];
  let currentLine = tracker.getActiveCodes();
  let currentWidth = 0;

  for (const unit of textUnits(word)) {
    if (unit.ansi) {
      currentLine += unit.text;
      tracker.process(unit.text);
      continue;
    }
    const clusterWidth = visibleWidth(unit.text);
    if (currentWidth + clusterWidth > width) {
      lines.push(withLineEndReset(currentLine, tracker));
      currentLine = tracker.getActiveCodes();
      currentWidth = 0;
    }
    currentLine += unit.text;
    currentWidth += clusterWidth;
  }

  if (currentLine !== "") {
    lines.push(currentLine);
  }
  return lines.length > 0 ? lines : [""];
}

function pushLongToken(state: WrapState, token: string): void {
  if (state.line !== "") {
    state.wrapped.push(withLineEndReset(state.line, state.tracker));
  }
  const broken = breakLongWord(token, state.width, state.tracker);
  const lastBroken = broken.pop();
  if (lastBroken === undefined) throw new Error("breakLongWord returned no lines");
  state.wrapped.push(...broken);
  state.line = lastBroken;
  state.lineWidth = visibleWidth(state.line);
}

function pushToken(state: WrapState, token: string, tokenWidth: number): void {
  const isWhitespace = token.trim() === "";
  if (state.lineWidth + tokenWidth > state.width && state.lineWidth > 0) {
    state.wrapped.push(withLineEndReset(state.line.trimEnd(), state.tracker));
    state.line = state.tracker.getActiveCodes() + (isWhitespace ? "" : token);
    state.lineWidth = isWhitespace ? 0 : tokenWidth;
  } else {
    state.line += token;
    state.lineWidth += tokenWidth;
  }
  updateTrackerFromText(token, state.tracker);
}

function wrapSingleLine(line: string, width: number): string[] {
  if (line === "") {
    return [""];
  }
  if (visibleWidth(line) <= width) {
    return [line];
  }

  const state: WrapState = {
    wrapped: [],
    line: "",
    lineWidth: 0,
    tracker: new AnsiCodeTracker(),
    width,
  };
  for (const token of splitIntoTokensWithAnsi(line)) {
    const tokenWidth = visibleWidth(token);
    if (tokenWidth > width && token.trim() !== "") {
      pushLongToken(state, token);
    } else {
      pushToken(state, token, tokenWidth);
    }
  }

  if (state.line !== "") {
    state.wrapped.push(state.line);
  }
  return state.wrapped.length > 0
    ? state.wrapped.map((wrappedLine) => wrappedLine.trimEnd())
    : [""];
}

export const wrapTextWithAnsi: {
  (text: string, width: number): string[];
  (width: number): (text: string) => string[];
} = dual(2, (text: string, width: number): string[] => {
  if (text === "") {
    return [""];
  }

  const inputLines = text.split(/\r\n|\r|\n/u);
  const result: string[] = [];
  const tracker = new AnsiCodeTracker();

  for (const inputLine of inputLines) {
    const prefix = result.length > 0 ? tracker.getActiveCodes() : "";
    const wrappedLines = wrapSingleLine(prefix + inputLine, width);
    for (const wrappedLine of wrappedLines) {
      result.push(wrappedLine);
    }
    updateTrackerFromText(inputLine, tracker);
  }

  return result.length > 0 ? result : [""];
});

export const applyBackgroundToLine: {
  (line: string, width: number, bgFn: (text: string) => string): string;
  (width: number, bgFn: (text: string) => string): (line: string) => string;
} = dual(3, (line: string, width: number, bgFn: (text: string) => string): string => {
  const visibleLen = visibleWidth(line);
  const paddingNeeded = Math.max(0, width - visibleLen);
  const padding = " ".repeat(paddingNeeded);

  const withPadding = line + padding;
  return bgFn(withPadding);
});
