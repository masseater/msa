import type diffFormatTypes from "./diff-format.types.ts";

declare namespace editDiffTypes {
  interface FuzzyMatchResult {
    found: boolean;
    index: number;
    matchLength: number;
    usedFuzzyMatch: boolean;
    contentForReplacement: string;
  }

  interface Edit {
    oldText: string;
    newText: string;
  }

  interface AppliedEditsResult {
    baseContent: string;
    newContent: string;
  }

  interface EditDiffError {
    error: string;
  }

  type EditDiffResult = diffFormatTypes.EditDiffResult;
}

export type { editDiffTypes as default };
