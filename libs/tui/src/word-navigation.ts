import { dual } from "effect/Function";

import { isWhitespaceChar, PUNCTUATION_REGEX } from "./text-boundaries.ts";
import { getWordSegmenter } from "./utils.ts";

const wordSegmenter = getWordSegmenter();

export interface WordNavigationOptions {
  segment?: (text: string) => Iterable<Intl.SegmentData>;
  isAtomicSegment?: (segment: string) => boolean;
}

export const findWordBackward: {
  (text: string, cursor: number, options?: WordNavigationOptions): number;
  (cursor: number, options?: WordNavigationOptions): (text: string) => number;
} = dual(
  (args) => typeof args[0] === "string",
  (text: string, cursor: number, options?: WordNavigationOptions): number => {
    if (cursor <= 0) return 0;

    const textBeforeCursor = text.slice(0, cursor);
    const segmentFn = options?.segment;
    const isAtomic = options?.isAtomicSegment;
    const segments =
      segmentFn === undefined
        ? [...wordSegmenter.segment(textBeforeCursor)]
        : [...segmentFn(textBeforeCursor)];
    let newCursor = cursor;

    while (
      segments.length > 0 &&
      isAtomic?.(segments[segments.length - 1]?.segment || "") !== true &&
      isWhitespaceChar(segments[segments.length - 1]?.segment || "")
    ) {
      newCursor -= segments.pop()?.segment.length || 0;
    }

    if (segments.length === 0) return newCursor;

    const last = segments[segments.length - 1]!;

    if (isAtomic?.(last.segment) === true) {
      newCursor -= last.segment.length;
    } else if (last.isWordLike === true) {
      const segment = last.segment;
      const matches = [...segment.matchAll(new RegExp(PUNCTUATION_REGEX, "gu"))];
      if (matches.length <= 0) {
        newCursor -= segment.length;
      } else {
        const lastMatch = matches[matches.length - 1]!;
        newCursor -= segment.length - (lastMatch.index + lastMatch[0].length);
      }
    } else {
      while (
        segments.length > 0 &&
        isAtomic?.(segments[segments.length - 1]?.segment || "") !== true &&
        segments[segments.length - 1]?.isWordLike !== true &&
        !isWhitespaceChar(segments[segments.length - 1]?.segment || "")
      ) {
        newCursor -= segments.pop()?.segment.length || 0;
      }
    }

    return newCursor;
  },
);

export const findWordForward: {
  (text: string, cursor: number, options?: WordNavigationOptions): number;
  (cursor: number, options?: WordNavigationOptions): (text: string) => number;
} = dual(
  (args) => typeof args[0] === "string",
  (text: string, cursor: number, options?: WordNavigationOptions): number => {
    if (cursor >= text.length) return text.length;

    const textAfterCursor = text.slice(cursor);
    const segmentFn = options?.segment;
    const isAtomic = options?.isAtomicSegment;
    const segments =
      segmentFn === undefined ? wordSegmenter.segment(textAfterCursor) : segmentFn(textAfterCursor);
    const iterator = segments[Symbol.iterator]();
    let next = iterator.next();
    let newCursor = cursor;

    while (
      next.done !== true &&
      isAtomic?.(next.value.segment) !== true &&
      isWhitespaceChar(next.value.segment)
    ) {
      newCursor += next.value.segment.length;
      next = iterator.next();
    }

    if (next.done === true) return newCursor;

    if (isAtomic?.(next.value.segment) === true) {
      newCursor += next.value.segment.length;
    } else if (next.value.isWordLike === true) {
      newCursor += PUNCTUATION_REGEX.exec(next.value.segment)?.index ?? next.value.segment.length;
    } else {
      while (
        next.done !== true &&
        isAtomic?.(next.value.segment) !== true &&
        next.value.isWordLike !== true &&
        !isWhitespaceChar(next.value.segment)
      ) {
        newCursor += next.value.segment.length;
        next = iterator.next();
      }
    }

    return newCursor;
  },
);
