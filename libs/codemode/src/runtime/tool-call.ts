import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import { dual } from "effect/Function";

import { errorMessage, parseJson, stringifyJson } from "./bridge.ts";
import type { CallMessage, ExecutionOptions } from "./launcher.ts";

export class ToolCallError extends Data.TaggedError("ToolCallError")<{ readonly message: string }> {
  constructor(message: string) {
    super({ message });
  }
}

const toCallError = (error: unknown) => new ToolCallError(errorMessage(error));

type Executors = ExecutionOptions["executors"];
type Invocation = Effect.Effect<string | undefined, ToolCallError>;

const invoke = (executors: Executors, message: CallMessage, signal: AbortSignal): Invocation => {
  const isTool = message.target === "tool";
  const tool = (isTool ? executors.tools : executors.globals).get(message.name);
  if (tool === undefined)
    return Effect.fail(
      new ToolCallError(`Unknown ${isTool ? "tool" : "global"} "${message.name}"`),
    );
  return Effect.tryPromise({
    try: () => {
      const args = message.args === undefined ? undefined : parseJson(message.args);
      return Promise.resolve(tool.execute(args, { signal }));
    },
    catch: toCallError,
  }).pipe(
    Effect.flatMap((value) => Effect.try({ try: () => stringifyJson(value), catch: toCallError })),
  );
};

export const invokeTool: {
  (message: CallMessage, signal: AbortSignal): (executors: Executors) => Invocation;
  (executors: Executors, message: CallMessage, signal: AbortSignal): Invocation;
} = dual(3, invoke);
