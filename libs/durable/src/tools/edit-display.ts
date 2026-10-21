import * as Diff from "diff";
import { Function } from "effect";

import type dualTypes from "../dual.ts";
import type typesModule from "../harness/types.types.ts";
import type editDisplayTypes from "./edit-display.types.ts";

const CONTEXT_LINES = 4;

const generateUnifiedPatch = (path: string, oldContent: string, newContent: string): string =>
  Diff.createTwoFilesPatch(path, path, oldContent, newContent, undefined, undefined, {
    context: CONTEXT_LINES,
    headerOptions: Diff.FILE_HEADERS_ONLY,
  });

type DisplayDiff = { readonly diff: string; readonly firstChangedLine: number | undefined };

type Cursor = {
  oldLine: number;
  newLine: number;
  readonly width: number;
  readonly output: string[];
};

type ContextWindow = {
  readonly head: readonly string[];
  readonly skipped: number;
  readonly tail: readonly string[];
};

function contextWindow(raw: readonly string[], leading: boolean, trailing: boolean): ContextWindow {
  if (leading && trailing && raw.length <= CONTEXT_LINES * 2)
    return { head: raw, skipped: 0, tail: [] };
  const head = leading ? raw.slice(0, CONTEXT_LINES) : [];
  const tail = trailing ? raw.slice(Math.max(head.length, raw.length - CONTEXT_LINES)) : [];
  return { head, skipped: raw.length - head.length - tail.length, tail };
}

function pushContext(cursor: Cursor, lines: readonly string[]): void {
  for (const line of lines) {
    cursor.output.push(` ${String(cursor.oldLine).padStart(cursor.width, " ")} ${line}`);
    cursor.oldLine++;
    cursor.newLine++;
  }
}

function pushUnchanged(
  cursor: Cursor,
  raw: readonly string[],
  leading: boolean,
  trailing: boolean,
) {
  if (!leading && !trailing) {
    cursor.oldLine += raw.length;
    cursor.newLine += raw.length;
    return;
  }
  const { head, skipped, tail } = contextWindow(raw, leading, trailing);
  pushContext(cursor, head);
  if (skipped > 0) {
    cursor.output.push(` ${"".padStart(cursor.width, " ")} ...`);
    cursor.oldLine += skipped;
    cursor.newLine += skipped;
  }
  pushContext(cursor, tail);
}

function pushChanged(cursor: Cursor, raw: readonly string[], added: boolean): void {
  for (const line of raw) {
    if (added) {
      cursor.output.push(`+${String(cursor.newLine).padStart(cursor.width, " ")} ${line}`);
      cursor.newLine++;
    } else {
      cursor.output.push(`-${String(cursor.oldLine).padStart(cursor.width, " ")} ${line}`);
      cursor.oldLine++;
    }
  }
}

const partLines = (value: string): string[] => {
  const raw = value.split("\n");
  if (raw[raw.length - 1] === "") raw.pop();
  return raw;
};

function generateDiffString(oldContent: string, newContent: string): DisplayDiff {
  const parts = Diff.diffLines(oldContent, newContent);
  const lineCount = Math.max(oldContent.split("\n").length, newContent.split("\n").length);
  const cursor: Cursor = { newLine: 1, oldLine: 1, output: [], width: String(lineCount).length };
  let lastWasChange = false;
  let firstChangedLine: number | undefined;
  for (const [index, part] of parts.entries()) {
    const raw = partLines(part.value);
    if (part.added || part.removed) {
      firstChangedLine ??= cursor.newLine;
      pushChanged(cursor, raw, part.added);
      lastWasChange = true;
      continue;
    }
    const next = parts[index + 1];
    pushUnchanged(cursor, raw, lastWasChange, next !== undefined && (next.added || next.removed));
    lastWasChange = false;
  }
  return { diff: cursor.output.join("\n"), firstChangedLine };
}

const editedResult: dualTypes.Dual4<
  string,
  number,
  string,
  string,
  typesModule.ToolExecutionResult<editDisplayTypes.EditToolDetails>
> = Function.dual(
  4,
  (
    path: string,
    editCount: number,
    base: string,
    next: string,
  ): typesModule.ToolExecutionResult<editDisplayTypes.EditToolDetails> => {
    const diffResult = generateDiffString(base, next);
    const details: editDisplayTypes.EditToolDetails = {
      diff: diffResult.diff,
      patch: generateUnifiedPatch(path, base, next),
      ...(diffResult.firstChangedLine === undefined
        ? {}
        : { firstChangedLine: diffResult.firstChangedLine }),
    };
    return {
      details,
      output: [{ text: `Successfully replaced ${editCount} block(s) in ${path}.`, type: "text" }],
    };
  },
);

const notFoundError: dualTypes.Dual3<string, number, number, Error> = Function.dual(
  3,
  (path: string, editIndex: number, totalEdits: number): Error =>
    new Error(
      totalEdits === 1
        ? `Could not find the exact text in ${path}. The old text must match exactly including all whitespace and newlines.`
        : `Could not find edits[${editIndex}] in ${path}. The oldText must match exactly including all whitespace and newlines.`,
    ),
);

const duplicateError: dualTypes.Dual4<string, number, number, number, Error> = Function.dual(
  4,
  (path: string, editIndex: number, totalEdits: number, occurrences: number): Error =>
    new Error(
      totalEdits === 1
        ? `Found ${occurrences} occurrences of the text in ${path}. The text must be unique. Please provide more context to make it unique.`
        : `Found ${occurrences} occurrences of edits[${editIndex}] in ${path}. Each oldText must be unique. Please provide more context to make it unique.`,
    ),
);

const emptyOldTextError: dualTypes.Dual3<string, number, number, Error> = Function.dual(
  3,
  (path: string, editIndex: number, totalEdits: number): Error =>
    new Error(
      totalEdits === 1
        ? `oldText must not be empty in ${path}.`
        : `edits[${editIndex}].oldText must not be empty in ${path}.`,
    ),
);

const noChangeError: dualTypes.Dual2<string, number, Error> = Function.dual(
  2,
  (path: string, totalEdits: number): Error =>
    new Error(
      totalEdits === 1
        ? `No changes made to ${path}. The replacement produced identical content. This might indicate an issue with special characters or the text not existing as expected.`
        : `No changes made to ${path}. The replacements produced identical content.`,
    ),
);

const editDisplay = {
  duplicateError,
  editedResult,
  emptyOldTextError,
  noChangeError,
  notFoundError,
};

export default editDisplay;
