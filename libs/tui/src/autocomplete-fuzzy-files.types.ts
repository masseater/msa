declare namespace autocompleteFuzzyFilesTypes {
  interface FuzzyFileQuery {
    basePath: string;
    fdPath: string | null;
    query: string;
    isQuotedPrefix: boolean;
    signal: AbortSignal;
  }
}

export type { autocompleteFuzzyFilesTypes as default };
