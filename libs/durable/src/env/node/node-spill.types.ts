import type { Effect } from "effect";

import type fileErrorTypes from "../file-error.types.ts";
import type resultTypes from "../result.types.ts";
import type OutputSpillClass from "./node-spill.ts";

declare namespace nodeSpillTypes {
  interface SpillHooks {
    readonly pause: () => void;
    readonly resume: () => void;
    readonly abort: () => void;
    readonly createTempFile: Effect.Effect<resultTypes.Result<string, fileErrorTypes.FileError>>;
  }

  interface SpillThreshold {
    readonly afterBytes: number;
    readonly afterLines: number;
  }

  type OutputSpill = OutputSpillClass;
}

export type { nodeSpillTypes as default };
