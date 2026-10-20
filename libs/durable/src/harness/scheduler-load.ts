import { Effect, Function } from "effect";

import stepModule from "../step.ts";
import schedulerRecords from "./scheduler-records.ts";
import type schedulerStateTypes from "./scheduler-state.types.ts";
import schedulerTypes from "./scheduler-types.ts";
import type schedulerTypesModule from "./scheduler-types.types.ts";
import util from "./util.ts";

const { failedOutcome, nodeOf, parentOf } = schedulerRecords;
const { eachStep, thenStep } = stepModule;
const { scanAll } = util;
const { SCAN_PAGE_SIZE } = schedulerTypes;

const conversationEdge = Effect.fnUntraced(function* (
  state: schedulerStateTypes.SchedulerState,
  conversation: schedulerTypesModule.ConversationId,
) {
  const record = yield* Effect.promise(() =>
    state.options.storage.conversation(conversation, state.options.context),
  );
  const edge = record?.owner?.taskId ?? null;
  state.graph.setEdge(conversation, edge);
  state.wake.reconcile();
  return edge;
});

const loadNode = Effect.fnUntraced(function* (
  state: schedulerStateTypes.SchedulerState,
  id: schedulerTypesModule.TaskId,
) {
  const record = yield* Effect.promise(() => state.options.storage.task(id, state.options.context));
  if (record === undefined) return undefined;
  const node: schedulerTypesModule.TaskNode = nodeOf(record);
  if (record.state.status === "terminal") state.graph.settle(id, node);
  state.wake.reconcile();
  return node;
});

type Walk = {
  readonly state: schedulerStateTypes.SchedulerState;
  readonly overlay: schedulerTypesModule.Overlay | undefined;
  readonly passed: schedulerTypesModule.TaskId[];
};

const upOf = (edge: schedulerTypesModule.TaskId | null): schedulerTypesModule.Up | undefined =>
  edge === null ? undefined : { task: edge };

const resumeAt = (walk: Walk, at: schedulerTypesModule.Up | undefined): Effect.Effect<boolean> => {
  const result = walkFrom(walk, at);
  return typeof result === "boolean" ? Effect.succeed(result) : result;
};

const walkFrom = (
  walk: Walk,
  start: schedulerTypesModule.Up | undefined,
): boolean | Effect.Effect<boolean> => {
  const { state, overlay, passed } = walk;
  const { graph } = state;
  let at = start;
  while (at !== undefined) {
    if (!("task" in at)) {
      const edge = graph.edge(at.conversation, overlay);
      if (edge === undefined) {
        return Effect.flatMap(conversationEdge(state, at.conversation), (loaded) =>
          resumeAt(walk, upOf(loaded)),
        );
      }
      at = upOf(edge);
      continue;
    }
    const id: schedulerTypesModule.TaskId = at.task;
    const node: schedulerTypesModule.TaskNode | undefined =
      graph.live.get(id) ?? graph.settled.get(id);
    if (node === undefined && overlay?.tasks.has(id) === true) return true;
    if (node !== undefined && !graph.unloaded.has(id)) return true;
    if (node === undefined) {
      return Effect.flatMap(loadNode(state, id), (loaded) => {
        if (loaded === undefined) return Effect.succeed(false);
        passed.push(id);
        return resumeAt(walk, parentOf(loaded));
      });
    }
    passed.push(id);
    at = parentOf(node);
  }
  return true;
};

const forget = (
  state: schedulerStateTypes.SchedulerState,
  passed: readonly schedulerTypesModule.TaskId[],
  complete: boolean,
): void => {
  if (!complete) return;
  for (const id of passed) state.graph.unloaded.delete(id);
};

const loadChain: schedulerTypesModule.Dual3<
  schedulerStateTypes.SchedulerState,
  schedulerTypesModule.Up,
  schedulerTypesModule.Overlay | undefined,
  Effect.Effect<void>
> = Function.dual(
  3,
  (
    state: schedulerStateTypes.SchedulerState,
    start: schedulerTypesModule.Up,
    overlay: schedulerTypesModule.Overlay | undefined,
  ) => {
    const passed: schedulerTypesModule.TaskId[] = [];
    const result = walkFrom({ overlay, passed, state }, start);
    if (typeof result === "boolean") {
      forget(state, passed, result);
      return Effect.void;
    }
    return Effect.map(result, (complete) => forget(state, passed, complete));
  },
);

const loadPending = (state: schedulerStateTypes.SchedulerState): Effect.Effect<void> => {
  const { graph } = state;
  if (graph.unloaded.size === 0) return Effect.void;
  return eachStep([...graph.unloaded], (id) =>
    graph.unloaded.has(id) ? loadChain(state, { task: id }, undefined) : Effect.void,
  );
};

const noScopes: Effect.Effect<readonly schedulerTypesModule.ConversationId[]> = Effect.succeed([]);

const loadQueued = Effect.fnUntraced(function* (state: schedulerStateTypes.SchedulerState) {
  const { options } = state;
  const submissions = yield* scanAll((cursor) =>
    options.storage.scanSubmissions({ status: "queued" }, SCAN_PAGE_SIZE, cursor, options.context),
  );
  const inputs = submissions.filter((submission) => submission.type === "input");
  const conversations = [...new Set(inputs.map((submission) => submission.conversationId))];
  yield* eachStep(conversations, (id) => loadChain(state, { conversation: id }, undefined));
  return conversations;
});

const loadScopes: schedulerTypesModule.Dual2<
  schedulerStateTypes.SchedulerState,
  boolean,
  Effect.Effect<readonly schedulerTypesModule.ConversationId[]>
> = Function.dual(2, (state: schedulerStateTypes.SchedulerState, queued: boolean) =>
  thenStep(loadPending(state), () => (queued ? loadQueued(state) : noScopes)),
);

const failedFrom = Effect.fnUntraced(function* (
  state: schedulerStateTypes.SchedulerState,
  ids: readonly schedulerTypesModule.TaskId[],
  from: number,
) {
  for (const id of ids.slice(from)) {
    const record =
      state.graph.live.get(id) ??
      (yield* Effect.promise(() => state.options.storage.task(id, state.options.context)));
    if (record !== undefined && failedOutcome(record)) return true;
  }
  return false;
});

const anyFailed: schedulerTypesModule.Dual2<
  schedulerStateTypes.SchedulerState,
  readonly schedulerTypesModule.TaskId[],
  Effect.Effect<boolean>
> = Function.dual(
  2,
  (
    state: schedulerStateTypes.SchedulerState,
    ids: readonly schedulerTypesModule.TaskId[],
  ): Effect.Effect<boolean> => {
    for (let index = 0; index < ids.length; index++) {
      const record = state.graph.live.get(ids[index]!);
      if (record === undefined) return failedFrom(state, ids, index);
      if (failedOutcome(record)) return Effect.succeed(true);
    }
    return Effect.succeed(false);
  },
);

const schedulerLoad = {
  anyFailed,
  loadChain,
  loadPending,
  loadScopes,
};

export default schedulerLoad;
