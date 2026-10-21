import type output from "./output.ts";

declare namespace outputTypes {
  type OutputLimits = {
    readonly maxBytes: number;
    readonly maxLines: number;
    readonly retain: "head" | "tail";
  };

  type BoundedOutput = {
    readonly text: string;
    readonly droppedBytes: number;
    readonly droppedLines: number;
  };

  type OutputSlice = {
    readonly text: string;
    readonly bytes: number;
    readonly droppedBytes: number;
    readonly droppedLines: number;
  };

  interface OutputSkip {
    readonly bytes: number;
    readonly newlines: number;
    readonly endsWithNewline: boolean;
  }

  type OutputBuffer = (typeof output.OutputBuffer)["prototype"];
}

export type { outputTypes as default };
