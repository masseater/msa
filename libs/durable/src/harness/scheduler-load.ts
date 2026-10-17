import { Effect } from "effect";

import { failedOutcome, nodeOf, parentOf } from "./scheduler-records.ts";
import type { SchedulerState } from "./scheduler-state.ts";
import {
  type Overlay,
  SCAN_PAGE_SIZE,
  type TaskNode,
  type Up,
  type ConversationId,
  type TaskId,
} from "./scheduler-types.ts";
import { scanAll } from "./util.ts";

const conversationStep = Effect.fn("conversationStep")(function* (
  state: SchedulerState,
  conversation: ConversationId,
  overlay: Overlay | undefined,
) {
  let edge = state.graph.edge(conversation, overlay);
  if (edge === undefined) {
    const record = yield* Effect.promise(() =>
      state.options.storage.conversation(conversation, state.options.context),
    );
    edge = record?.owner?.taskId ?? null;
    state.graph.setEdge(conversation, edge);
    state.wake.reconcile();
  }
  return edge === null ? undefined : { task: edge };
});

const loadNode = Effect.fn("loadNode")(function* (state: SchedulerState, id: TaskId) {
  const record = yield* Effect.promise(() => state.options.storage.task(id, state.options.context));
  if (record === undefined) return undefined;
  const node: TaskNode = nodeOf(record);
  if (record.state.status === "terminal") state.graph.settle(id, node);
  state.wake.reconcile();
  return node;
});

const loadSteps = Effect.fn("loadSteps")(function* (
  state: SchedulerState,
  start: Up,
  overlay: Overlay | undefined,
  passed: TaskId[],
) {
  const { graph } = state;
  let at: Up | undefined = start;
  while (at !== undefined) {
    if (!("task" in at)) {
      at = yield* conversationStep(state, at.conversation, overlay);
      continue;
    }
    const id: TaskId = at.task;
    let node: TaskNode | undefined = graph.live.get(id) ?? graph.settled.get(id);
    if (node === undefined && overlay?.tasks.has(id) === true) return true;
    if (node !== undefined && !graph.unloaded.has(id)) return true;
    node ??= yield* loadNode(state, id);
    if (node === undefined) return false;
    passed.push(id);
    at = parentOf(node);
  }
  return true;
});

export const loadChain = Effect.fn("loadChain")(function* (
  state: SchedulerState,
  start: Up,
  overlay?: Overlay,
) {
  const passed: TaskId[] = [];
  if (!(yield* loadSteps(state, start, overlay, passed))) return;
  for (const id of passed) state.graph.unloaded.delete(id);
});

export const loadScopes = Effect.fn("loadScopes")(function* (
  state: SchedulerState,
  queued: boolean,
) {
  const { graph, options } = state;
  yield* Effect.forEach(
    [...graph.unloaded],
    (id) => (graph.unloaded.has(id) ? loadChain(state, { task: id }) : Effect.void),
    { discard: true },
  );
  if (!queued) return [];
  const submissions = yield* scanAll((cursor) =>
    options.storage.scanSubmissions({ status: "queued" }, SCAN_PAGE_SIZE, cursor, options.context),
  );
  const inputs = submissions.filter((submission) => submission.type === "input");
  const conversations = [...new Set(inputs.map((submission) => submission.conversationId))];
  yield* Effect.forEach(conversations, (id) => loadChain(state, { conversation: id }), {
    discard: true,
  });
  return conversations;
});

export const anyFailed = Effect.fn("anyFailed")(function* (
  state: SchedulerState,
  ids: readonly TaskId[],
) {
  for (const id of ids) {
    const record =
      state.graph.live.get(id) ??
      (yield* Effect.promise(() => state.options.storage.task(id, state.options.context)));
    if (record !== undefined && failedOutcome(record)) return true;
  }
  return false;
});
