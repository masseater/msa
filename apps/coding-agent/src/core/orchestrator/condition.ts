import { Effect } from "effect";

import type runtimeTypes from "./runtime.types.ts";

const CONDITION_TIMEOUT_MS = 60_000;

function runCondition(
  runtime: runtimeTypes.Runtime,
  command: string,
  cwd: string,
): Effect.Effect<boolean> {
  return Effect.promise((signal) =>
    runtime.options.runCommand(command, cwd, CONDITION_TIMEOUT_MS, signal),
  ).pipe(Effect.map((result) => result.exitCode === 0));
}

const conditions = { runCondition };

const condition = {
  conditions,
};

export default condition;
