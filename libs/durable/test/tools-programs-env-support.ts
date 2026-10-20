import type chordTypes from "@msa/chord/index.types";
import { Effect } from "effect";

import envModule from "../src/env/index.ts";
import type envTypes from "../src/env/index.types.ts";
import node from "../src/env/node.ts";
import type nodeTypes from "../src/env/node.types.ts";
import toolsSupport from "./tools-support.ts";

const { NodeExecutionEnv } = node;
const { ExecutionError, err } = envModule;

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
      options: envTypes.ShellExecOptions | undefined,
      context: chordTypes.Context,
    ): Promise<envTypes.Result<envTypes.ShellExecResult, envTypes.ExecutionError>> {
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
  const env: nodeTypes.NodeExecutionEnv = new ProgramsEnv({ cwd: yield* createTempDir });
  return { commands, env };
});

export default programsEnv;
