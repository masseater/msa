import * as Effect from "effect/Effect";

import awaitingModule from "./awaiting.ts";
import type bashExecutorTypes from "./bash-executor.types.ts";
import BashOutputCapture from "./bash-output-capture.ts";
import type bashTypes from "./tools/bash.types.ts";

const { awaited, awaiting } = awaitingModule;

function executeBashWithOperations(
  command: string,
  cwd: string,
  operations: bashTypes.BashOperations,
  options?: bashExecutorTypes.BashExecutorOptions,
): Promise<bashExecutorTypes.BashResult> {
  return Effect.runPromise(
    awaiting(function* () {
      const capture = new BashOutputCapture(options?.onChunk);
      let exitCode: number | null = null;
      try {
        ({ exitCode } = yield* awaited(
          operations.exec(command, cwd, { onData: capture.write, signal: options?.signal }),
        ));
      } catch (err) {
        if (options?.signal?.aborted !== true) {
          capture.discard();
          throw err;
        }
      }
      const output = yield* capture.finish();
      const cancelled = options?.signal?.aborted ?? false;
      return {
        cancelled,
        exitCode: cancelled ? undefined : (exitCode ?? undefined),
        ...output,
      };
    }),
  );
}

const bashExecutor = {
  executeBashWithOperations,
};

export default bashExecutor;
