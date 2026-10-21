import type OutputAccumulatorClass from "./output-accumulator.ts";
import type truncateTypes from "./truncate.types.ts";

declare namespace outputAccumulatorTypes {
  interface OutputAccumulatorOptions {
    maxLines?: number;
    maxBytes?: number;
    tempFilePrefix?: string;
  }

  interface OutputSnapshot {
    content: string;
    truncation: truncateTypes.TruncationResult;
    fullOutputPath?: string | undefined;
  }

  interface FullOutput {
    content: string;
    truncated: boolean;
  }

  type OutputAccumulator = (typeof OutputAccumulatorClass)["prototype"];
}

export type { outputAccumulatorTypes as default };
