import type truncateTypes from "./truncate.types.ts";

declare namespace findSupportTypes {
  interface FindToolDetails {
    truncation?: truncateTypes.TruncationResult;
    resultLimitReached?: number;
  }

  interface FindPathModule {
    readonly sep: string;
    readonly isAbsolute: (path: string) => boolean;
    readonly relative: (from: string, to: string) => string;
  }

  interface FindRequest {
    pattern: string;
    searchPath: string;
    effectiveLimit: number;
  }

  interface FindOutputInput {
    results: string[];
    effectiveLimit: number;
    limitNotice: string;
  }

  interface FindOperations {
    exists: (absolutePath: string) => Promise<boolean> | boolean;
    glob: (
      pattern: string,
      cwd: string,
      options: { ignore: string[]; limit: number },
    ) => Promise<string[]> | string[];
  }
}

export type { findSupportTypes as default };
