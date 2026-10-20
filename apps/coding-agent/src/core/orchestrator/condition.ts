import { Effect } from "effect";

import type runtimeTypes from "./runtime.types.ts";

function runCondition(
  runtime: runtimeTypes.Runtime,
  command: string,
  cwd: string,
): Effect.Effect<boolean> {
  return Effect.promise(() => runtime.options.runCondition(command, cwd));
}

const conditions = { runCondition };

const condition = {
  conditions,
};

export default condition;
