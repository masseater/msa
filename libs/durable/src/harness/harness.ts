import type { Context } from "@msa/chord";
import { withoutAbortSignal } from "@msa/chord/context";
import { Effect } from "effect";

import harnessBound from "./harness-bound.ts";
import harnessImpl from "./harness-impl.ts";
import type harnessTypes from "./harness.types.ts";
import registryModule from "./registry.ts";
import type typesModule from "./types.types.ts";

const { BUILTIN_TASKS } = registryModule;
const { HarnessImpl } = harnessImpl;

const checkBuiltins = <Tool extends typesModule.ToolRegistration>(
  options: typesModule.HarnessOptions<Tool>,
): void => {
  const snapshot = options.registry.snapshot();
  const missing = BUILTIN_TASKS.filter((task) => snapshot.task(task.definition.name) === undefined);
  if (missing.length > 0) {
    const names = missing.map((task) => task.definition.name).join(", ");
    throw new Error(`Registry lacks built-in tasks ${names}; create it with createRegistry()`);
  }
};

const openHarness = Effect.fnUntraced(function* <Tool extends typesModule.ToolRegistration>(
  storage: typesModule.Storage,
  options: typesModule.HarnessOptions<Tool>,
  context: Context,
) {
  context.abortSignal?.throwIfAborted();
  checkBuiltins(options);
  const harness = new HarnessImpl(storage, options, context);
  yield* Effect.onError(
    Effect.promise(() => harness.openTasks(context)),
    () => Effect.ignoreCause(Effect.promise(() => harness.close(withoutAbortSignal(context)))),
  );
  return harness as harnessTypes.Harness;
});

const HarnessFactory = {
  open<Tool extends typesModule.ToolRegistration>(
    storage: typesModule.Storage,
    options: typesModule.HarnessOptions<Tool>,
    context: Context,
  ): Promise<harnessTypes.Harness> {
    return Effect.runPromise(openHarness(storage, options, context));
  },
};

const harnessModule = {
  Harness: HarnessFactory,
  SCHEDULER_INDEX_SIZES: harnessImpl.SCHEDULER_INDEX_SIZES,
  safeNow: harnessBound.safeNow,
};

export default harnessModule;
