import { dual } from "effect/Function";

import { getGraphemeSegmenter, getWordSegmenter } from "../utils.ts";

export type SegmentMode = "word" | "grapheme";

export const PASTE_MARKER_REGEX = /\[paste #(\d+)( (\+\d+ lines|\d+ chars))?\]/gu;

export const PASTE_MARKER_SINGLE = /^\[paste #(\d+)( (\+\d+ lines|\d+ chars))?\]$/u;

const graphemeSegmenter = getGraphemeSegmenter();
const wordSegmenter = getWordSegmenter();

export function isPasteMarker(segment: string): boolean {
  return segment.length >= 10 && PASTE_MARKER_SINGLE.test(segment);
}

export function graphemeSegments(text: string): Intl.SegmentData[] {
  return [...graphemeSegmenter.segment(text)];
}

export function normalizeEditorText(text: string): string {
  return text.replace(/\r\n/gu, "\n").replace(/\r/gu, "\n").replace(/\t/gu, "    ");
}

interface MarkerRange {
  start: number;
  end: number;
}

function markerRanges(text: string, validIds: ReadonlySet<number>): MarkerRange[] {
  const markers: MarkerRange[] = [];
  for (const m of text.matchAll(PASTE_MARKER_REGEX)) {
    const id = Number.parseInt(m[1]!, 10);
    if (!validIds.has(id)) continue;
    markers.push({ start: m.index, end: m.index + m[0].length });
  }
  return markers;
}

function mergeMarkers(
  text: string,
  baseSegments: Iterable<Intl.SegmentData>,
  markers: readonly MarkerRange[],
): Intl.SegmentData[] {
  const result: Intl.SegmentData[] = [];
  let markerIdx = 0;
  for (const seg of baseSegments) {
    while (markerIdx < markers.length && markers[markerIdx]!.end <= seg.index) {
      markerIdx++;
    }
    const marker = markerIdx < markers.length ? markers[markerIdx]! : null;
    if (marker === null || seg.index < marker.start || seg.index >= marker.end) {
      result.push(seg);
    } else if (seg.index === marker.start) {
      result.push({
        segment: text.slice(marker.start, marker.end),
        index: marker.start,
        input: text,
      });
    }
  }
  return result;
}

export const segmentText: {
  (text: string, mode: SegmentMode, validIds: ReadonlySet<number>): Iterable<Intl.SegmentData>;
  (mode: SegmentMode, validIds: ReadonlySet<number>): (text: string) => Iterable<Intl.SegmentData>;
} = dual(
  3,
  (text: string, mode: SegmentMode, validIds: ReadonlySet<number>): Iterable<Intl.SegmentData> => {
    const baseSegmenter = mode === "word" ? wordSegmenter : graphemeSegmenter;
    if (validIds.size === 0 || !text.includes("[paste #")) {
      return baseSegmenter.segment(text);
    }
    const markers = markerRanges(text, validIds);
    if (markers.length === 0) {
      return baseSegmenter.segment(text);
    }
    return mergeMarkers(text, baseSegmenter.segment(text), markers);
  },
);

export const renumberPasteMarkers: {
  (lines: readonly string[], removedId: number): string[];
  (removedId: number): (lines: readonly string[]) => string[];
} = dual(2, (lines: readonly string[], removedId: number): string[] =>
  lines.map((lineText) =>
    lineText.replace(PASTE_MARKER_REGEX, (fullMatch, idGroup, suffixGroup) => {
      const x = Number(idGroup);
      if (x <= removedId) return fullMatch;
      return `[paste #${x - 1}${suffixGroup}]`;
    }),
  ),
);

export const expandPasteMarkers: {
  (text: string, pastes: ReadonlyMap<number, string>): string;
  (pastes: ReadonlyMap<number, string>): (text: string) => string;
} = dual(2, (text: string, pastes: ReadonlyMap<number, string>): string => {
  let result = text;
  for (const [pasteId, pasteContent] of pastes) {
    const markerRegex = new RegExp(`\\[paste #${pasteId}( (\\+\\d+ lines|\\d+ chars))?\\]`, "gu");
    result = result.replace(markerRegex, () => pasteContent);
  }
  return result;
});
