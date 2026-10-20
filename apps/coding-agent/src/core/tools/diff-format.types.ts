declare namespace diffFormatTypes {
  interface EditDiffResult {
    diff: string;
    firstChangedLine: number | undefined;
  }
}

export type { diffFormatTypes as default };
