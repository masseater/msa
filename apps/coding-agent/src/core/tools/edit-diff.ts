import { Effect, FileSystem, Predicate, Result } from "effect";
import { dual } from "effect/Function";

import { toErrorMessage } from "../../utils/errors.ts";
import { splitBom } from "../../utils/text.ts";
import { platformRuntime } from "../platform/index.ts";
import { type EditDiffResult, generateDiffString } from "./diff-format.ts";
import {
  type MatchedEdit,
  applyReplacements,
  applyReplacementsPreservingUnchangedLines,
} from "./edit-replacements.ts";
import {
  detectLineEnding,
  normalizeForFuzzyMatch,
  normalizeToLF,
  restoreLineEndings,
} from "./edit-text.ts";
import { resolveToCwd } from "./path-utils.ts";

export { type EditDiffResult, generateDiffString, generateUnifiedPatch } from "./diff-format.ts";
export { detectLineEnding, normalizeToLF, restoreLineEndings };

export interface FuzzyMatchResult {
  found: boolean;
  index: number;
  matchLength: number;
  usedFuzzyMatch: boolean;
  contentForReplacement: string;
}

export interface Edit {
  oldText: string;
  newText: string;
}

export interface AppliedEditsResult {
  baseContent: string;
  newContent: string;
}

export const fuzzyFindText: {
  (oldText: string): (content: string) => FuzzyMatchResult;
  (content: string, oldText: string): FuzzyMatchResult;
} = dual(2, (content: string, oldText: string): FuzzyMatchResult => {
  const exactIndex = content.indexOf(oldText);
  if (exactIndex !== -1) {
    return {
      contentForReplacement: content,
      found: true,
      index: exactIndex,
      matchLength: oldText.length,
      usedFuzzyMatch: false,
    };
  }

  const fuzzyContent = normalizeForFuzzyMatch(content);
  const fuzzyOldText = normalizeForFuzzyMatch(oldText);
  const fuzzyIndex = fuzzyContent.indexOf(fuzzyOldText);

  if (fuzzyIndex === -1) {
    return {
      contentForReplacement: content,
      found: false,
      index: -1,
      matchLength: 0,
      usedFuzzyMatch: false,
    };
  }

  return {
    contentForReplacement: fuzzyContent,
    found: true,
    index: fuzzyIndex,
    matchLength: fuzzyOldText.length,
    usedFuzzyMatch: true,
  };
});

function countOccurrences(content: string, oldText: string): number {
  const fuzzyContent = normalizeForFuzzyMatch(content);
  const fuzzyOldText = normalizeForFuzzyMatch(oldText);
  return fuzzyContent.split(fuzzyOldText).length - 1;
}

interface EditLocation {
  path: string;
  editIndex: number;
  totalEdits: number;
}

function getNotFoundError({ path, editIndex, totalEdits }: EditLocation): Error {
  if (totalEdits === 1) {
    return new Error(
      `Could not find the exact text in ${path}. The old text must match exactly including all whitespace and newlines.`,
    );
  }
  return new Error(
    `Could not find edits[${editIndex}] in ${path}. The oldText must match exactly including all whitespace and newlines.`,
  );
}

function getDuplicateError(location: EditLocation, occurrences: number): Error {
  const { path, editIndex, totalEdits } = location;
  if (totalEdits === 1) {
    return new Error(
      `Found ${occurrences} occurrences of the text in ${path}. The text must be unique. Please provide more context to make it unique.`,
    );
  }
  return new Error(
    `Found ${occurrences} occurrences of edits[${editIndex}] in ${path}. Each oldText must be unique. Please provide more context to make it unique.`,
  );
}

function getEmptyOldTextError({ path, editIndex, totalEdits }: EditLocation): Error {
  if (totalEdits === 1) {
    return new Error(`oldText must not be empty in ${path}.`);
  }
  return new Error(`edits[${editIndex}].oldText must not be empty in ${path}.`);
}

function getNoChangeError(path: string, totalEdits: number): Error {
  if (totalEdits === 1) {
    return new Error(
      `No changes made to ${path}. The replacement produced identical content. This might indicate an issue with special characters or the text not existing as expected.`,
    );
  }
  return new Error(`No changes made to ${path}. The replacements produced identical content.`);
}

function matchEdits(
  replacementBaseContent: string,
  normalizedEdits: Edit[],
  path: string,
): MatchedEdit[] {
  const totalEdits = normalizedEdits.length;
  return normalizedEdits.map((edit, editIndex) => {
    const location = { editIndex, path, totalEdits };
    const matchResult = fuzzyFindText(replacementBaseContent, edit.oldText);
    if (!matchResult.found) throw getNotFoundError(location);
    const occurrences = countOccurrences(replacementBaseContent, edit.oldText);
    if (occurrences > 1) throw getDuplicateError(location, occurrences);
    return {
      editIndex,
      matchIndex: matchResult.index,
      matchLength: matchResult.matchLength,
      newText: edit.newText,
    };
  });
}

function assertDisjoint(sortedEdits: MatchedEdit[], path: string): void {
  for (const [i, current] of sortedEdits.entries()) {
    const previous = sortedEdits[i - 1];
    if (previous !== undefined && previous.matchIndex + previous.matchLength > current.matchIndex) {
      throw new Error(
        `edits[${previous.editIndex}] and edits[${current.editIndex}] overlap in ${path}. Merge them into one edit or target disjoint regions.`,
      );
    }
  }
}

function applyEditsImpl(
  normalizedContent: string,
  edits: Edit[],
  path: string,
): AppliedEditsResult {
  const normalizedEdits = edits.map((edit) => ({
    newText: normalizeToLF(edit.newText),
    oldText: normalizeToLF(edit.oldText),
  }));

  for (const [i, edit] of normalizedEdits.entries()) {
    if (edit.oldText.length === 0) {
      throw getEmptyOldTextError({ editIndex: i, path, totalEdits: normalizedEdits.length });
    }
  }

  const usedFuzzyMatch = normalizedEdits.some(
    (edit) => fuzzyFindText(normalizedContent, edit.oldText).usedFuzzyMatch,
  );
  const replacementBaseContent = usedFuzzyMatch
    ? normalizeForFuzzyMatch(normalizedContent)
    : normalizedContent;

  const matchedEdits = matchEdits(replacementBaseContent, normalizedEdits, path);
  matchedEdits.sort((a, b) => a.matchIndex - b.matchIndex);
  assertDisjoint(matchedEdits, path);

  const newContent = usedFuzzyMatch
    ? applyReplacementsPreservingUnchangedLines({
        baseContent: replacementBaseContent,
        originalContent: normalizedContent,
        replacements: matchedEdits,
      })
    : applyReplacements({ content: replacementBaseContent, replacements: matchedEdits });

  if (normalizedContent === newContent) {
    throw getNoChangeError(path, normalizedEdits.length);
  }
  return { baseContent: normalizedContent, newContent };
}

export const applyEditsToNormalizedContent: {
  (edits: Edit[], path: string): (normalizedContent: string) => AppliedEditsResult;
  (normalizedContent: string, edits: Edit[], path: string): AppliedEditsResult;
} = dual((args) => typeof args[0] === "string", applyEditsImpl);

export interface EditDiffError {
  error: string;
}

const causeOf = (error: unknown): unknown =>
  Predicate.hasProperty(error, "cause") && error.cause !== undefined ? error.cause : error;

const failureMessage = (error: unknown): string => toErrorMessage(causeOf(error));

const describeAccessError = (error: unknown): string => {
  const cause = causeOf(error);
  return cause instanceof Error && "code" in cause ? `Error code: ${cause.code}` : String(cause);
};

const diffFromContent = (rawContent: string, edits: Edit[], path: string): EditDiffResult => {
  const { text: content } = splitBom(rawContent);
  const { baseContent, newContent } = applyEditsImpl(normalizeToLF(content), edits, path);
  return generateDiffString(baseContent, newContent);
};

const computeDiffEffect = (path: string, edits: Edit[], cwd: string) => {
  const absolutePath = resolveToCwd(path, cwd);
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const access = yield* Effect.result(fs.access(absolutePath, { readable: true }));
    if (Result.isFailure(access)) {
      const error = `Could not edit file: ${path}. ${describeAccessError(access.failure)}.`;
      return { error };
    }
    const rawContent = yield* fs.readFileString(absolutePath, "utf-8");
    return yield* Effect.try(() => diffFromContent(rawContent, edits, path));
  }).pipe(Effect.catch((error) => Effect.succeed({ error: failureMessage(error) })));
};

export const computeEditsDiff: {
  (edits: Edit[], cwd: string): (path: string) => Promise<EditDiffResult | EditDiffError>;
  (path: string, edits: Edit[], cwd: string): Promise<EditDiffResult | EditDiffError>;
} = dual(
  (args) => typeof args[0] === "string",
  (path: string, edits: Edit[], cwd: string): Promise<EditDiffResult | EditDiffError> =>
    platformRuntime.runPromise(computeDiffEffect(path, edits, cwd)),
);
