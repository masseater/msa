import type { Context } from "@msa/chord";
import { Effect } from "effect";

import {
  ExecutionError,
  type Result,
  type ShellExecOptions,
  type ShellExecResult,
  err,
} from "../src/env/index.ts";
import { NodeExecutionEnv } from "../src/env/node.ts";
import toolsSupport from "./tools-support.ts";

const { createTempDir } = toolsSupport;

const programsEnv = Effect.fn("programsEnv")(function* (
  installed: readonly string[],
  output: string,
  exitCode = 0,
) {
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
  return { commands, env: new ProgramsEnv({ cwd: yield* createTempDir }) };
});

export default programsEnv;
