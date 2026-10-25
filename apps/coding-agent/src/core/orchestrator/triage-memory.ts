import { Effect } from "effect";

import progressStore from "./progress-store.ts";
import runtimeModule from "./runtime.ts";
import type runtimeTypes from "./runtime.types.ts";
import storeModule from "./store.ts";
import type triageTypes from "./triage.types.ts";
import workProgress from "./work-progress.ts";

const { nowMillis } = runtimeModule;
const { store } = storeModule;
const { askKey } = progressStore;

function repeats(runtime: runtimeTypes.Runtime, ask: triageTypes.Ask): Effect.Effect<boolean> {
  return Effect.gen(function* () {
    const decided = store.triageDecisionsOf(runtime.database, ask.taskId);
    const last = decided.at(-1);
    if (last === undefined) return false;
    const key = askKey(ask.key);
    if (key !== "" && decided.some((decision) => decision.requestKey === key)) return true;
    const contents = yield* workProgress.contentsOf(runtime, ask.threadId);
    return last.contentsId !== null && contents?.id === last.contentsId;
  });
}

function remember(
  runtime: runtimeTypes.Runtime,
  taskId: string,
  ask: triageTypes.Ask | undefined,
): Effect.Effect<void> {
  return Effect.gen(function* () {
    const contents =
      ask === undefined ? undefined : yield* workProgress.contentsOf(runtime, ask.threadId);
    const now = yield* nowMillis;
    store.saveTriageDecision(
      runtime.database,
      taskId,
      { contentsId: contents?.id ?? null, requestKey: askKey(ask?.key ?? "") },
      now,
    );
  });
}

function escalate(runtime: runtimeTypes.Runtime, taskId: string): Effect.Effect<void> {
  return Effect.map(nowMillis, (now) =>
    store.setTaskStatus(runtime.database, taskId, "needs-decision", now),
  );
}

const triageMemory = { escalate, remember, repeats };

export default triageMemory;
