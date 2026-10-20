import type { Context } from "@msa/chord";
import { Effect } from "effect";

import env from "../src/env/index.ts";
import type envTypes from "../src/env/index.types.ts";
import node from "../src/env/node.ts";
import truncate from "../src/truncate.ts";
import effectSupport from "./effect-support.ts";

const { DEFAULT_MAX_LINES } = truncate;
const { NodeExecutionEnv } = node;
const { ExecutionError, err, getOrThrow } = env;

const { awaited } = effectSupport;

const TRUNCATED_OUTPUT_LINES = DEFAULT_MAX_LINES + 1;

class TimeoutOutputExecutionEnv extends NodeExecutionEnv {
  override exec(
    _command: string | readonly string[],
    options: envTypes.ShellExecOptions | undefined,
    context: Context,
  ): Promise<envTypes.Result<envTypes.ShellExecResult, envTypes.ExecutionError>> {
    return Effect.runPromise(
      Effect.gen({ self: this }, function* () {
        const output = `${Array.from({ length: TRUNCATED_OUTPUT_LINES }, (_, index) => `line-${index + 1}`).join("\n")}\n`;
        const spillPath = getOrThrow(
          yield* awaited(this.createTempFile({ prefix: "timeout-", suffix: ".log" }, context)),
        );
        getOrThrow(yield* awaited(this.writeFile(spillPath, output, context)));
        options?.onOutput?.(output, context, { stream: "stdout" });
        const error = new ExecutionError("timeout", `timeout:${options?.timeout}`);
        error.spillPath = spillPath;
        return err(error);
      }),
    );
  }
}

const toolsTimeoutEnvSupport = {
  TRUNCATED_OUTPUT_LINES,
  TimeoutOutputExecutionEnv,
};

export default toolsTimeoutEnvSupport;
