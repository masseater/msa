import type RgMatchCollectorClass from "./rg-match-collector.ts";
import type truncateTypes from "./truncate.types.ts";

declare namespace grepSupportTypes {
  interface GrepToolDetails {
    truncation?: truncateTypes.TruncationResult;
    matchLimitReached?: number;
    linesTruncated?: boolean;
  }

  interface GrepOperations {
    isDirectory: (absolutePath: string) => Promise<boolean> | boolean;
    readFile: (absolutePath: string) => Promise<string> | string;
  }

  interface GrepRequest {
    pattern: string;
    searchPath: string;
    glob: string | undefined;
    ignoreCase: boolean | undefined;
    literal: boolean | undefined;
    contextValue: number;
    effectiveLimit: number;
    isDirectory: boolean;
  }

  interface RgMatch {
    filePath: string;
    lineNumber: number;
    lineText?: string | undefined;
  }

  interface GrepOutputInput {
    outputLines: string[];
    effectiveLimit: number;
    matchLimitReached: boolean;
    linesTruncated: boolean;
  }

  type RgMatchCollector = (typeof RgMatchCollectorClass)["prototype"];
}

export type { grepSupportTypes as default };
