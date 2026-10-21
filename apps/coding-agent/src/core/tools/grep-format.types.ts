import type GrepFormatterClass from "./grep-format.ts";
import type grepSupportTypes from "./grep-support.types.ts";

declare namespace grepFormatTypes {
  interface GrepFormatterOptions {
    ops: grepSupportTypes.GrepOperations;
    searchPath: string;
    isDirectory: boolean;
    contextValue: number;
  }

  type GrepFormatter = (typeof GrepFormatterClass)["prototype"];
}

export type { grepFormatTypes as default };
