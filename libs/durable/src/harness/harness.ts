import type { Context } from "@msa/chord";
import { withoutAbortSignal } from "@msa/chord/context";
import { Effect } from "effect";

import { HarnessImpl } from "./harness-impl.ts";
import { BUILTIN_TASKS } from "./registry.ts";
import type { Harness as HarnessType, HarnessOptions, Storage, ToolRegistration } from "./types.ts";

export { safeNow } from "./harness-bound.ts";
export { SCHEDULER_INDEX_SIZES } from "./harness-impl.ts";

export type Harness = HarnessType;

const checkBuiltins = <Tool extends ToolRegistration>(options: HarnessOptions<Tool>): void => {
  const snapshot = options.registry.snapshot();
  const missing = BUILTIN_TASKS.filter((task) => snapshot.task(task.definition.name) === undefined);
  if (missing.length > 0) {
    const names = missing.map((task) => task.definition.name).join(", ");
    throw new Error(`Registry lacks built-in tasks ${names}; create it with createRegistry()`);
  }
};

const openHarness = Effect.fnUntraced(function* <Tool extends ToolRegistration>(
  storage: Storage,
  options: HarnessOptions<Tool>,
  context: Context,
) {
  context.abortSignal?.throwIfAborted();
  checkBuiltins(options);
  const harness = new HarnessImpl(storage, options, context);
  yield* Effect.onError(
    Effect.promise(() => harness.openTasks(context)),
    () => Effect.ignoreCause(Effect.promise(() => harness.close(withoutAbortSignal(context)))),
  );
  return harness as Harness;
});

const HarnessFactory = {
  open<Tool extends ToolRegistration>(
    storage: Storage,
    options: HarnessOptions<Tool>,
    context: Context,
  ): Promise<Harness> {
    return Effect.runPromise(openHarness(storage, options, context));
  },
};

export { HarnessFactory as Harness };
