import { Function } from "effect";

import type { Dual2, Dual3, Dual4 } from "../dual.ts";

export const notFoundError: Dual3<string, number, number, Error> = Function.dual(
  3,
  (path: string, editIndex: number, totalEdits: number): Error =>
    new Error(
      totalEdits === 1
        ? `Could not find the exact text in ${path}. The old text must match exactly including all whitespace and newlines.`
        : `Could not find edits[${editIndex}] in ${path}. The oldText must match exactly including all whitespace and newlines.`,
    ),
);

export const duplicateError: Dual4<string, number, number, number, Error> = Function.dual(
  4,
  (path: string, editIndex: number, totalEdits: number, occurrences: number): Error =>
    new Error(
      totalEdits === 1
        ? `Found ${occurrences} occurrences of the text in ${path}. The text must be unique. Please provide more context to make it unique.`
        : `Found ${occurrences} occurrences of edits[${editIndex}] in ${path}. Each oldText must be unique. Please provide more context to make it unique.`,
    ),
);

export const emptyOldTextError: Dual3<string, number, number, Error> = Function.dual(
  3,
  (path: string, editIndex: number, totalEdits: number): Error =>
    new Error(
      totalEdits === 1
        ? `oldText must not be empty in ${path}.`
        : `edits[${editIndex}].oldText must not be empty in ${path}.`,
    ),
);

export const noChangeError: Dual2<string, number, Error> = Function.dual(
  2,
  (path: string, totalEdits: number): Error =>
    new Error(
      totalEdits === 1
        ? `No changes made to ${path}. The replacement produced identical content. This might indicate an issue with special characters or the text not existing as expected.`
        : `No changes made to ${path}. The replacements produced identical content.`,
    ),
);
