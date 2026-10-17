import type { Context } from "@msa/chord";

import {
  ExecutionError,
  err,
  type Result,
  type ShellExecOptions,
  type ShellExecResult,
} from "../src/env/index.ts";
import { NodeExecutionEnv } from "../src/env/node.ts";
import { createTempDir } from "./tools-support.ts";

// An environment where only the listed programs exist; it records each command and prints `output`.
export function programsEnv(installed: readonly string[], output: string, exitCode = 0) {
  const commands: (string | readonly string[])[] = [];
  class ProgramsEnv extends NodeExecutionEnv {
    override exec(
      command: string | readonly string[],
      options: ShellExecOptions | undefined,
      context: Context,
    ): Promise<Result<ShellExecResult, ExecutionError>> {
      commands.push(command);
      if (typeof command === "string" || !installed.includes(command[0]!)) {
        return Promise.resolve(
          err(new ExecutionError("spawn_error", `spawn ${command[0]} ENOENT`)),
        );
      }
      options?.onOutput?.(output, context, { stream: "stdout" });
      return Promise.resolve({ ok: true, value: { exitCode } });
    }
  }
  return { env: new ProgramsEnv({ cwd: createTempDir() }), commands };
}
