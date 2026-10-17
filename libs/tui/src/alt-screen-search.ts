import { dual } from "effect/Function";

import { getGraphemeSegmenter, stripTerminalSequences, visibleWidth } from "./utils.ts";

const segmenter = getGraphemeSegmenter();

interface SearchSourceSpan {
  textStart: number;
  textEnd: number;
  row: number;
  startCol: number;
  endCol: number;
  linearColumns: boolean;
}

interface SearchCorpus {
  text: string;
  spans: SearchSourceSpan[];
}

export interface AltScreenSearchSegment {
  row: number;
  startCol: number;
  endCol: number;
}

export interface AltScreenSearchMatch {
  segments: AltScreenSearchSegment[];
}

const PRINTABLE_ASCII = /^[\x20-\x7e]*$/u;

interface CorpusState {
  chunks: string[];
  spans: SearchSourceSpan[];
  textLength: number;
  pendingSeparator: boolean;
}

interface CorpusToken {
  text: string;
  row: number;
  startCol: number;
  endCol: number;
  linearColumns: boolean;
}

function markSeparator(state: CorpusState): void {
  if (state.textLength > 0) state.pendingSeparator = true;
}

function appendToken(state: CorpusState, token: CorpusToken): void {
  if (state.pendingSeparator) {
    state.chunks.push(" ");
    state.textLength += 1;
    state.pendingSeparator = false;
  }
  state.chunks.push(token.text);
  state.spans.push({
    textStart: state.textLength,
    textEnd: state.textLength + token.text.length,
    row: token.row,
    startCol: token.startCol,
    endCol: token.endCol,
    linearColumns: token.linearColumns,
  });
  state.textLength += token.text.length;
}

function appendAsciiLine(state: CorpusState, line: string, row: number): void {
  let index = 0;
  while (index < line.length) {
    if (line.charCodeAt(index) === 0x20) {
      markSeparator(state);
      index += 1;
      continue;
    }
    let end = index + 1;
    while (end < line.length && line.charCodeAt(end) !== 0x20) end += 1;
    const text = line.slice(index, end);
    appendToken(state, { text, row, startCol: index, endCol: end, linearColumns: true });
    index = end;
  }
}

function appendGraphemeLine(state: CorpusState, line: string, row: number): void {
  let column = 0;
  for (const grapheme of segmenter.segment(line)) {
    const text = grapheme.segment;
    const width = visibleWidth(text);
    if (/^\s+$/u.test(text)) {
      markSeparator(state);
    } else {
      appendToken(state, {
        text,
        row,
        startCol: column,
        endCol: column + width,
        linearColumns: false,
      });
    }
    column += width;
  }
}

function buildSearchCorpus(lines: readonly string[]): SearchCorpus {
  const state: CorpusState = { chunks: [], spans: [], textLength: 0, pendingSeparator: false };
  for (let row = 0; row < lines.length; row++) {
    const line = stripTerminalSequences(lines[row] ?? "");
    if (PRINTABLE_ASCII.test(line)) {
      appendAsciiLine(state, line, row);
    } else {
      appendGraphemeLine(state, line, row);
    }
    markSeparator(state);
  }
  return { text: state.chunks.join(""), spans: state.spans };
}

function normalizeQuery(query: string): string {
  return query.replace(/\s+/gu, " ").trim();
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function findSearchCorpusMatches(
  corpus: SearchCorpus,
  normalizedQuery: string,
): AltScreenSearchMatch[] {
  if (normalizedQuery === "") return [];
  const expression = new RegExp(escapeRegExp(normalizedQuery), "giu");
  const matches: AltScreenSearchMatch[] = [];
  let spanIndex = 0;

  for (const match of corpus.text.matchAll(expression)) {
    const start = match.index;
    const end = start + match[0].length;
    while (spanIndex < corpus.spans.length && corpus.spans[spanIndex]!.textEnd <= start)
      spanIndex += 1;

    const segments: AltScreenSearchSegment[] = [];
    for (let index = spanIndex; index < corpus.spans.length; index++) {
      const span = corpus.spans[index]!;
      if (span.textStart >= end) break;
      if (span.textEnd <= start) continue;
      const startCol = span.linearColumns
        ? span.startCol + Math.max(start, span.textStart) - span.textStart
        : span.startCol;
      const endCol = span.linearColumns
        ? span.startCol + Math.min(end, span.textEnd) - span.textStart
        : span.endCol;
      const previous = segments[segments.length - 1];
      if (previous !== undefined && previous.row === span.row && startCol <= previous.endCol) {
        previous.endCol = Math.max(previous.endCol, endCol);
      } else {
        segments.push({ row: span.row, startCol, endCol });
      }
    }
    while (spanIndex < corpus.spans.length && corpus.spans[spanIndex]!.textEnd <= end)
      spanIndex += 1;
    if (segments.length > 0) matches.push({ segments });
  }

  return matches;
}

export interface AltScreenSearchResult {
  matches: AltScreenSearchMatch[];
  changed: boolean;
}

export class AltScreenSearchIndex {
  private sourceLines: string[] | undefined;
  private corpus: SearchCorpus | undefined;
  private normalizedQuery: string | undefined;
  private matches: AltScreenSearchMatch[] = [];

  search(lines: readonly string[], query: string): AltScreenSearchResult {
    let sourceChanged = this.sourceLines?.length !== lines.length;
    if (!sourceChanged && this.sourceLines !== undefined) {
      for (let index = 0; index < lines.length; index++) {
        if (this.sourceLines[index] === lines[index]) continue;
        sourceChanged = true;
        break;
      }
    }
    if (sourceChanged || this.corpus === undefined) {
      this.sourceLines = Array.from(lines);
      this.corpus = buildSearchCorpus(lines);
    }

    const normalizedQuery = normalizeQuery(query);
    const changed = sourceChanged || normalizedQuery !== this.normalizedQuery;
    if (changed) {
      this.normalizedQuery = normalizedQuery;
      this.matches = findSearchCorpusMatches(this.corpus, normalizedQuery);
    }
    return { matches: this.matches, changed };
  }
}

export const findAltScreenSearchMatches: {
  (lines: readonly string[], query: string): AltScreenSearchMatch[];
  (query: string): (lines: readonly string[]) => AltScreenSearchMatch[];
} = dual(2, (lines: readonly string[], query: string): AltScreenSearchMatch[] => {
  const normalizedQuery = normalizeQuery(query);
  return normalizedQuery === ""
    ? []
    : findSearchCorpusMatches(buildSearchCorpus(lines), normalizedQuery);
});

export function getAltScreenSearchMatchKey(match: AltScreenSearchMatch): string {
  const first = match.segments[0];
  const last = match.segments[match.segments.length - 1];
  return first !== undefined && last !== undefined
    ? `${first.row}:${first.startCol}:${last.row}:${last.endCol}`
    : "";
}
