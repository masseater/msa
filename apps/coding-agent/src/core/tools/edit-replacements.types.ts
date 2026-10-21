declare namespace editReplacementsTypes {
  interface MatchedEdit {
    editIndex: number;
    matchIndex: number;
    matchLength: number;
    newText: string;
  }

  type TextReplacement = Pick<MatchedEdit, "matchIndex" | "matchLength" | "newText">;

  interface ApplyReplacementsInput {
    content: string;
    replacements: TextReplacement[];
    offset?: number;
  }

  interface PreserveUnchangedInput {
    originalContent: string;
    baseContent: string;
    replacements: TextReplacement[];
  }
}

export type { editReplacementsTypes as default };
