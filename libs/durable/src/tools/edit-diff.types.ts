declare namespace editDiffTypes {
  interface Edit {
    oldText: string;
    newText: string;
  }

  interface AppliedEditsResult {
    readonly baseContent: string;
    readonly newContent: string;
    readonly fileContent: string;
  }
}

export type { editDiffTypes as default };
