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

interface Earlier {
  request: string;
  decision: string;
  filesChanged: boolean;
}

function repeats(runtime: runtimeTypes.Runtime, ask: triageTypes.Ask): boolean {
  const key = askKey(ask.key);
  return (
    key !== "" &&
    store
      .triageDecisionsOf(runtime.database, ask.taskId)
      .some((decision) => decision.requestKey === key)
  );
}

function earlier(runtime: runtimeTypes.Runtime, ask: triageTypes.Ask): Effect.Effect<Earlier[]> {
  return Effect.gen(function* () {
    const decided = store.triageDecisionsOf(runtime.database, ask.taskId);
    if (decided.length === 0) return [];
    const contents = yield* workProgress.contentsOf(runtime, ask.threadId);
    return decided.map((decision) => ({
      decision: decision.decision,
      filesChanged: decision.contentsId === null || contents?.id !== decision.contentsId,
      request: decision.request,
    }));
  });
}

function remember(
  runtime: runtimeTypes.Runtime,
  taskId: string,
  ask: triageTypes.Ask | undefined,
  decision: string,
): Effect.Effect<void> {
  return Effect.gen(function* () {
    const contents =
      ask === undefined ? undefined : yield* workProgress.contentsOf(runtime, ask.threadId);
    const now = yield* nowMillis;
    store.saveTriageDecision(
      runtime.database,
      taskId,
      {
        contentsId: contents?.id ?? null,
        decision,
        request: ask?.request ?? "",
        requestKey: askKey(ask?.key ?? ""),
      },
      now,
    );
  });
}

function escalate(runtime: runtimeTypes.Runtime, taskId: string): Effect.Effect<void> {
  return Effect.map(nowMillis, (now) =>
    store.setTaskStatus(runtime.database, taskId, "needs-decision", now),
  );
}

const triageMemory = { earlier, escalate, remember, repeats };

export default triageMemory;
