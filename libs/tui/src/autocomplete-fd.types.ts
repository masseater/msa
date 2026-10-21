declare namespace autocompleteFdTypes {
  interface FdEntry {
    path: string;
    isDirectory: boolean;
  }

  interface FdWalkOptions {
    baseDir: string;
    fdPath: string;
    query: string;
    maxResults: number;
    signal: AbortSignal;
    maxDepth?: number;
  }
}

export type { autocompleteFdTypes as default };
