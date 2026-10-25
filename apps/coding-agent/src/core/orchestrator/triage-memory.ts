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

function repeated(
  runtime: runtimeTypes.Runtime,
  taskId: string,
  matches: (decision: triageTypes.Decision, number: number) => boolean,
): triageTypes.Repeated | undefined {
  const decisions = store.triageDecisionsOf(runtime.database, taskId);
  const index = decisions.findIndex((decision, at) => matches(decision, at + 1));
  return index === -1 ? undefined : { decision: decisions[index]!, number: index + 1 };
}

function repeats(
  runtime: runtimeTypes.Runtime,
  ask: triageTypes.Ask,
): triageTypes.Repeated | undefined {
  const key = askKey(ask.key);
  if (key === "") return undefined;
  return repeated(runtime, ask.taskId, (decision) => decision.requestKey === key);
}

function decisionNumber(
  runtime: runtimeTypes.Runtime,
  taskId: string,
  number: number,
): triageTypes.Repeated | undefined {
  return repeated(runtime, taskId, (_decision, at) => at === number);
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

const triageMemory = { decisionNumber, earlier, escalate, remember, repeats };

export default triageMemory;
