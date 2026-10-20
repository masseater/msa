import type chordTypes from "@msa/chord/index.types";
import type { Effect } from "effect";

import type executionErrorTypes from "../execution-error.types.ts";
import type fileErrorTypes from "../file-error.types.ts";
import type resultTypes from "../result.types.ts";
import type typesModule from "../types.ts";

declare namespace nodeExecTypes {
  interface ExecTarget {
    readonly cwd: string;
    readonly shellPath: string | undefined;
    readonly shellEnv: NodeJS.ProcessEnv | undefined;
    readonly activeChildPids: Set<number>;
    readonly createTempFile: Effect.Effect<resultTypes.Result<string, fileErrorTypes.FileError>>;
  }

  interface ExecRequest {
    readonly target: ExecTarget;
    readonly command: string | readonly string[];
    readonly options: typesModule.ShellExecOptions | undefined;
    readonly context: chordTypes.Context;
  }

  type ExecutionError = executionErrorTypes.ExecutionError;

  type Result<TValue, TError> = resultTypes.Result<TValue, TError>;
}

export type { nodeExecTypes as default };
