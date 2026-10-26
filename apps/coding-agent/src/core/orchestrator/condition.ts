import { Effect } from "effect";

import nodeChildProcess from "../platform/node/child-process.ts";
import type runtimeTypes from "./runtime.types.ts";

const { execFile } = nodeChildProcess;

const CONDITION_TIMEOUT_MS = 60_000;
const SYNTAX_TIMEOUT_MS = 10_000;
const COMMAND_SHELL = "/bin/sh";

function runCondition(
  runtime: runtimeTypes.Runtime,
  command: string,
  cwd: string,
): Effect.Effect<boolean> {
  return Effect.promise((signal) =>
    runtime.options.runCommand(command, cwd, CONDITION_TIMEOUT_MS, signal),
  ).pipe(Effect.map((result) => result.exitCode === 0));
}

function syntaxError(command: string): Effect.Effect<string | null> {
  return Effect.callback<string | null>((resume) => {
    const child = execFile(
      COMMAND_SHELL,
      ["-n", "-c", command],
      { timeout: SYNTAX_TIMEOUT_MS },
      (error, stdout, stderr) => {
        const output = `${stdout}${stderr}`.trim();
        resume(Effect.succeed(error === null ? null : output === "" ? error.message : output));
      },
    );
    return Effect.sync(() => child.kill());
  });
}

function requireValidCondition(title: string, command: string): Effect.Effect<void> {
  return Effect.gen(function* () {
    if (command.trim() === "") {
      throw new Error(`Task ${title} has an empty condition. Omit condition to start it at once.`);
    }
    const error = yield* syntaxError(command);
    if (error === null) return;
    throw new Error(
      `Task ${title} was not created: its condition does not parse in ${COMMAND_SHELL}, so it would never be met.\n${error}`,
    );
  });
}

const conditions = { requireValidCondition, runCondition };

const condition = {
  conditions,
};

export default condition;
