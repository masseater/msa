import type { Deferred } from "effect";
import { Effect } from "effect";

import type { OrchestratorError } from "./errors.ts";
import { applying } from "./replan-apply.ts";
import { ensured, exclusive, fail, stopThreads, unique } from "./replan-support.ts";
import type { Runtime } from "./runtime.ts";
import { snapshots } from "./snapshot.ts";
import { store } from "./store.ts";
import type {
  ReplanDropInput,
  ReplanInput,
  ReplanResult,
  ReplanRewireInput,
  ReplanTaskInput,
  TaskView,
} from "./types.ts";
import { wrapping } from "./wrap-up.ts";

interface Entry {
  input: ReplanTaskInput;
  from: readonly string[];
  key: string | null;
}

export interface Prepared {
  input: ReplanInput;
  entries: readonly Entry[];
  keep: readonly string[];
  drop: readonly ReplanDropInput[];
  rewire: readonly ReplanRewireInput[];
  sources: readonly string[];
  views: ReadonlyMap<string, TaskView>;
  memos: ReadonlyMap<string, Deferred.Deferred<string, string>>;
}

function assertKnown(views: ReadonlyMap<string, TaskView>, id: string, label: string): void {
  if (!views.has(id)) throw fail(`Unknown task in ${label}: ${id}`);
}

function assertDisjoint(left: readonly string[], right: readonly string[], label: string): void {
  const shared = left.filter((id) => right.includes(id));
  if (shared.length > 0) throw fail(`${label}: ${shared.join(", ")}`);
}

function entryKeys(entries: readonly Entry[], views: ReadonlyMap<string, TaskView>): Set<string> {
  const keys = new Set<string>();
  for (const entry of entries) {
    if (entry.key === null) continue;
    if (keys.has(entry.key)) throw fail(`Duplicate key in tasks: ${entry.key}`);
    if (views.has(entry.key)) throw fail(`Key ${entry.key} is also a task id`);
    keys.add(entry.key);
  }
  return keys;
}

function resolveRefs(
  refs: readonly string[],
  keys: ReadonlySet<string>,
  views: ReadonlyMap<string, TaskView>,
  label: string,
): void {
  for (const ref of refs) {
    if (!keys.has(ref)) assertKnown(views, ref, label);
  }
}

function inheritedState(
  entry: Entry,
  views: ReadonlyMap<string, TaskView>,
  pick: (task: TaskView) => string,
): string {
  return entry.from
    .flatMap((id) => views.get(id) ?? [])
    .map(pick)
    .filter((value) => value.trim() !== "")
    .join("\n\n");
}

function validateEntries(
  runtime: Runtime,
  entries: readonly Entry[],
  views: ReadonlyMap<string, TaskView>,
): void {
  const keys = entryKeys(entries, views);
  for (const entry of entries) {
    if (entry.input.title.trim() === "") throw fail("Every task needs a title");
    for (const id of entry.from) assertKnown(views, id, "from");
    const states = {
      currentState: entry.input.currentState ?? inheritedState(entry, views, (t) => t.currentState),
      goalState: entry.input.goalState ?? inheritedState(entry, views, (t) => t.goalState),
    };
    if (states.currentState.trim() === "" || states.goalState.trim() === "") {
      throw fail(`Task ${entry.input.title} needs a current state and a goal state`);
    }
    if (entry.input.model !== undefined) runtime.options.resolveModel(entry.input.model);
    resolveRefs(entry.input.dependsOn ?? [], keys, views, "dependsOn");
  }
}

function validateHandling(
  input: ReplanInput,
  entries: readonly Entry[],
  views: ReadonlyMap<string, TaskView>,
): void {
  const from = entries.flatMap((entry) => entry.from);
  const keep = unique(input.keep ?? []);
  const drop = (input.drop ?? []).map((item) => item.taskId);
  const rewire = (input.rewire ?? []).map((item) => item.taskId);
  for (const id of [...keep, ...drop, ...rewire]) assertKnown(views, id, "keep, drop, or rewire");
  assertDisjoint(keep, drop, "kept tasks are also dropped");
  assertDisjoint(keep, from, "kept tasks are also replaced");
  assertDisjoint(drop, from, "dropped tasks are also replaced");
  assertDisjoint(rewire, drop, "dropped tasks are also rewired");
  assertDisjoint(rewire, from, "replaced tasks are also rewired");
  if (new Set(drop).size !== drop.length) throw fail("A task is dropped twice");
  if (new Set(rewire).size !== rewire.length) throw fail("A task is rewired twice");
}

function validateStop(
  input: ReplanInput,
  entries: readonly Entry[],
  views: ReadonlyMap<string, TaskView>,
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
  runtime: Runtime,
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

function prepare(runtime: Runtime, input: ReplanInput): Effect.Effect<Prepared, OrchestratorError> {
  return Effect.gen(function* () {
    const views = new Map(
      snapshots
        .taskViews(runtime.database, runtime.options.project)
        .map((task) => [task.id, task] as const),
    );
    return yield* Effect.sync(() => {
      if (runtime.replanning) throw fail("A replan is already running");
      if (input.reason.trim() === "") throw fail("A replan needs a reason");
      const entries = (input.tasks ?? []).map((task) => ({
        from: unique(task.from ?? []),
        input: task,
        key: task.key ?? null,
      }));
      validateEntries(runtime, entries, views);
      validateHandling(input, entries, views);
      validateStop(input, entries, views);
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

function abortedResult(reason: string): ReplanResult {
  return {
    aborted: reason,
    created: [],
    dropped: [],
    kept: [],
    replanId: null,
    rewired: [],
    started: [],
    stopped: [],
  };
}

export function replan(runtime: Runtime, input: ReplanInput): Promise<ReplanResult> {
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
