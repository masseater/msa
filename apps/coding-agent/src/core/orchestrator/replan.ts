import type { Deferred } from "effect";
import { Effect } from "effect";

import replanApply from "./replan-apply.ts";
import replanSupport from "./replan-support.ts";
import replanValidate from "./replan-validate.ts";
import type replanTypes from "./replan.types.ts";
import type runtimeTypes from "./runtime.types.ts";
import snapshot from "./snapshot.ts";
import storeModule from "./store.ts";
import type orchestratorTypesTypes from "./types.types.ts";
import wrapUp from "./wrap-up.ts";

const { ensured, exclusive, fail, stopThreads, unique } = replanSupport;
const { wrapping } = wrapUp;
const { snapshots } = snapshot;
const { store } = storeModule;
const { applying } = replanApply;
const {
  validateClosed,
  validateCwds,
  validateEntries,
  validateHandling,
  validateRunningDependencies,
  validateTitles,
} = replanValidate;

function validateStop(
  input: orchestratorTypesTypes.ReplanInput,
  entries: readonly replanTypes.Entry[],
  views: ReadonlyMap<string, orchestratorTypesTypes.TaskView>,
): void {
  const running = [...views.values()].filter((task) => task.status === "running");
  const ids = new Set(running.map((task) => task.id));
  const replaced = entries.flatMap((entry) => entry.from);
  const dropped = (input.drop ?? []).map((item) => item.taskId);
  if (input.stop === false) {
    const active = [...replaced, ...dropped].filter((id) => ids.has(id));
    if (active.length > 0) {
      throw fail(`Cannot replace or drop a running task without stopping: ${active.join(", ")}`);
    }
    return;
  }
  const accounted = new Set([...replaced, ...dropped, ...(input.keep ?? [])]);
  const missing = [...ids].filter((id) => !accounted.has(id));
  if (missing.length > 0) {
    throw fail(
      `Running tasks must be kept, replaced, or dropped by this replan: ${missing.join(", ")}`,
    );
  }
}

function register(
  runtime: runtimeTypes.Runtime,
  threads: readonly string[],
): Map<string, Deferred.Deferred<string, string>> {
  const memos = new Map<string, Deferred.Deferred<string, string>>();
  for (const threadId of threads) {
    if (!runtime.workers.has(threadId)) {
      throw fail(`Thread ${threadId} is running without a worker; cannot wrap it up`);
    }
    memos.set(threadId, Effect.runSync(wrapping.begin(runtime, threadId)));
  }
  runtime.replanning = memos.size > 0;
  return memos;
}

function prepare(
  runtime: runtimeTypes.Runtime,
  input: orchestratorTypesTypes.ReplanInput,
): Effect.Effect<replanTypes.Prepared, runtimeTypes.OrchestratorError> {
  return Effect.gen(function* () {
    const views = new Map(
      snapshots
        .taskViews(runtime.database, runtime.options.project)
        .map((task) => [task.id, task] as const),
    );
    const entries = (input.tasks ?? []).map((task) => ({
      from: unique(task.from ?? []),
      input: task,
      key: task.key ?? null,
    }));
    yield* Effect.sync(() => {
      if (runtime.replanning) throw fail("A replan is already running");
      if (input.reason.trim() === "") throw fail("A replan needs a reason");
      validateEntries(runtime, entries, views);
    });
    yield* validateCwds(runtime, entries, views);
    return yield* Effect.sync(() => {
      if (runtime.replanning) throw fail("A replan is already running");
      validateHandling(input, entries, views);
      validateClosed(input, entries, views);
      validateTitles(input, entries, views);
      validateStop(input, entries, views);
      validateRunningDependencies(runtime, input, entries, views);
      const threads =
        input.stop === false
          ? []
          : store
              .runningThreads(runtime.database, runtime.options.project)
              .map((thread) => thread.id);
      return {
        drop: input.drop ?? [],
        entries,
        input,
        keep: unique(input.keep ?? []),
        memos: register(runtime, threads),
        rewire: input.rewire ?? [],
        sources: unique([
          ...entries.flatMap((entry) => entry.from),
          ...(input.drop ?? []).map((item) => item.taskId),
        ]),
        views,
      };
    });
  });
}

function abortedResult(reason: string): orchestratorTypesTypes.ReplanResult {
  return {
    aborted: reason,
    created: [],
    dropped: [],
    handedOver: [],
    kept: [],
    orphaned: [],
    replanId: null,
    rewired: [],
    started: [],
    stopped: [],
    untracked: [],
  };
}

function replan(
  runtime: runtimeTypes.Runtime,
  input: orchestratorTypesTypes.ReplanInput,
): Promise<orchestratorTypesTypes.ReplanResult> {
  return Effect.runPromise(
    ensured(
      runtime,
      Effect.gen(function* () {
        const prepared = yield* exclusive(runtime, prepare(runtime, input));
        const stop = yield* stopThreads(runtime, prepared.memos);
        if (stop.aborted !== null) return abortedResult(stop.aborted);
        return yield* exclusive(runtime, applying.apply(runtime, prepared, stop.memos));
      }),
    ),
  );
}

const replanModule = {
  replan,
};

export default replanModule;
