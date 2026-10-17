import type { Context } from "@msa/chord";

import {
  ExecutionError,
  err,
  getOrThrow,
  type Result,
  type ShellExecOptions,
  type ShellExecResult,
} from "../src/env/index.ts";
import { NodeExecutionEnv } from "../src/env/node.ts";
import { DEFAULT_MAX_LINES } from "../src/truncate.ts";

export const TRUNCATED_OUTPUT_LINES = DEFAULT_MAX_LINES + 1;

export class TimeoutOutputExecutionEnv extends NodeExecutionEnv {
  override async exec(
    _command: string | readonly string[],
    options: ShellExecOptions | undefined,
    context: Context,
  ): Promise<Result<ShellExecResult, ExecutionError>> {
    const output = `${Array.from({ length: TRUNCATED_OUTPUT_LINES }, (_, index) => `line-${index + 1}`).join("\n")}\n`;
    const spillPath = getOrThrow(
      await this.createTempFile({ prefix: "timeout-", suffix: ".log" }, context),
    );
    getOrThrow(await this.writeFile(spillPath, output, context));
    options?.onOutput?.(output, context, { stream: "stdout" });
    const error = new ExecutionError("timeout", `timeout:${options?.timeout}`);
    error.spillPath = spillPath;
    return err(error);
  }
}
