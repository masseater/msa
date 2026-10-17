import { Effect, Function } from "effect";

import { eachStep, thenStep } from "../step.ts";
import { failedOutcome, nodeOf, parentOf } from "./scheduler-records.ts";
import type { SchedulerState } from "./scheduler-state.ts";
import {
  type Overlay,
  SCAN_PAGE_SIZE,
  type TaskNode,
  type Up,
  type ConversationId,
  type TaskId,
  type Dual2,
  type Dual3,
} from "./scheduler-types.ts";
import { scanAll } from "./util.ts";

const conversationEdge = Effect.fnUntraced(function* (
  state: SchedulerState,
  conversation: ConversationId,
) {
  const record = yield* Effect.promise(() =>
    state.options.storage.conversation(conversation, state.options.context),
  );
  const edge = record?.owner?.taskId ?? null;
  state.graph.setEdge(conversation, edge);
  state.wake.reconcile();
  return edge;
});

const loadNode = Effect.fnUntraced(function* (state: SchedulerState, id: TaskId) {
  const record = yield* Effect.promise(() => state.options.storage.task(id, state.options.context));
  if (record === undefined) return undefined;
  const node: TaskNode = nodeOf(record);
  if (record.state.status === "terminal") state.graph.settle(id, node);
  state.wake.reconcile();
  return node;
});

type Walk = {
  readonly state: SchedulerState;
  readonly overlay: Overlay | undefined;
  readonly passed: TaskId[];
};

const upOf = (edge: TaskId | null): Up | undefined => (edge === null ? undefined : { task: edge });

const resumeAt = (walk: Walk, at: Up | undefined): Effect.Effect<boolean> => {
  const result = walkFrom(walk, at);
  return typeof result === "boolean" ? Effect.succeed(result) : result;
};

const walkFrom = (walk: Walk, start: Up | undefined): boolean | Effect.Effect<boolean> => {
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
    const id: TaskId = at.task;
    const node: TaskNode | undefined = graph.live.get(id) ?? graph.settled.get(id);
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

const forget = (state: SchedulerState, passed: readonly TaskId[], complete: boolean): void => {
  if (!complete) return;
  for (const id of passed) state.graph.unloaded.delete(id);
};

export const loadChain: Dual3<
  SchedulerState,
  Up,
  Overlay | undefined,
  Effect.Effect<void>
> = Function.dual(3, (state: SchedulerState, start: Up, overlay: Overlay | undefined) => {
  const passed: TaskId[] = [];
  const result = walkFrom({ state, overlay, passed }, start);
  if (typeof result === "boolean") {
    forget(state, passed, result);
    return Effect.void;
  }
  return Effect.map(result, (complete) => forget(state, passed, complete));
});

export const loadPending = (state: SchedulerState): Effect.Effect<void> => {
  const { graph } = state;
  if (graph.unloaded.size === 0) return Effect.void;
  return eachStep([...graph.unloaded], (id) =>
    graph.unloaded.has(id) ? loadChain(state, { task: id }, undefined) : Effect.void,
  );
};

const noScopes: Effect.Effect<readonly ConversationId[]> = Effect.succeed([]);

const loadQueued = Effect.fnUntraced(function* (state: SchedulerState) {
  const { options } = state;
  const submissions = yield* scanAll((cursor) =>
    options.storage.scanSubmissions({ status: "queued" }, SCAN_PAGE_SIZE, cursor, options.context),
  );
  const inputs = submissions.filter((submission) => submission.type === "input");
  const conversations = [...new Set(inputs.map((submission) => submission.conversationId))];
  yield* eachStep(conversations, (id) => loadChain(state, { conversation: id }, undefined));
  return conversations;
});

export const loadScopes: Dual2<
  SchedulerState,
  boolean,
  Effect.Effect<readonly ConversationId[]>
> = Function.dual(2, (state: SchedulerState, queued: boolean) =>
  thenStep(loadPending(state), () => (queued ? loadQueued(state) : noScopes)),
);

const failedFrom = Effect.fnUntraced(function* (
  state: SchedulerState,
  ids: readonly TaskId[],
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

export const anyFailed: Dual2<
  SchedulerState,
  readonly TaskId[],
  Effect.Effect<boolean>
> = Function.dual(2, (state: SchedulerState, ids: readonly TaskId[]): Effect.Effect<boolean> => {
  for (let index = 0; index < ids.length; index++) {
    const record = state.graph.live.get(ids[index]!);
    if (record === undefined) return failedFrom(state, ids, index);
    if (failedOutcome(record)) return Effect.succeed(true);
  }
  return Effect.succeed(false);
});
