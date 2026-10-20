import type foreignErrorTypes from "./foreign-error.types.ts";
import type toolFailureTypes from "./tool-failure.types.ts";

declare namespace platformTypes {
  interface PathOperations {
    readonly join: (...segments: ReadonlyArray<string>) => string;
    readonly resolve: (...segments: ReadonlyArray<string>) => string;
    readonly dirname: (path: string) => string;
    readonly basename: (path: string, suffix?: string) => string;
    readonly extname: (path: string) => string;
    readonly relative: (from: string, to: string) => string;
    readonly isAbsolute: (path: string) => boolean;
    readonly normalize: (path: string) => string;
    readonly sep: string;
  }

  type ForeignError = foreignErrorTypes.ForeignError;

  type ToolFailure = toolFailureTypes.ToolFailure;
}

export type { platformTypes as default };
