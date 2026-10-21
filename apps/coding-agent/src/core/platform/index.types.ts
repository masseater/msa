import type foreignErrorTypes from "./foreign-error.types.ts";
import type toolFailureTypes from "./tool-failure.types.ts";

declare namespace platformTypes {
  type EnvValues = Readonly<Record<string, string | undefined>>;

  interface Latch {
    readonly promise: Promise<void>;
    readonly open: () => void;
  }

  interface ParsedPath {
    readonly root: string;
    readonly dir: string;
    readonly base: string;
    readonly ext: string;
    readonly name: string;
  }

  interface Scheduled {
    readonly cancel: () => void;
  }

  type ForeignError = foreignErrorTypes.ForeignError;

  type ToolFailure = toolFailureTypes.ToolFailure;
}

export type { platformTypes as default };
