import { Effect } from "effect";

import type { Runtime } from "./runtime.ts";

function runCondition(runtime: Runtime, command: string, cwd: string): Effect.Effect<boolean> {
  return Effect.promise(() => runtime.options.runCondition(command, cwd));
}

export const conditions = { runCondition };
