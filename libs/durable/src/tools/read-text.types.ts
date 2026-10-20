import type { Effect } from "effect";

import type dualTypes from "../dual.ts";
import type envTypes from "../env/index.types.ts";
import type truncateTypes from "../truncate.types.ts";

declare namespace readTextTypes {
  type ReadToolDetails = {
    truncation?: Omit<truncateTypes.TruncationResult, "content">;
  };

  type BinarySource = {
    readonly info: Effect.Effect<envTypes.FileInfo>;
    read(position: number, length: number): Effect.Effect<Uint8Array>;
    scanLines(options: { startLine: number; endLine?: number }): Effect.Effect<envTypes.LineScan>;
    readonly close: Effect.Effect<void>;
  };

  type Dual2<A, B, R> = dualTypes.Dual2<A, B, R>;
}

export type { readTextTypes as default };
