import contextModule from "@msa/chord/context";
import type chordTypes from "@msa/chord/index.types";
import { Effect } from "effect";

import bridge from "./bridge.ts";
import schedulerFinalize from "./scheduler-finalize.ts";
import schedulerLoad from "./scheduler-load.ts";
import schedulerRecords from "./scheduler-records.ts";
import type schedulerStateTypes from "./scheduler-state.types.ts";
import type schedulerTypesModule from "./scheduler-types.types.ts";
import util from "./util.ts";

const { awaitWithContext } = contextModule;

const { loadScopes } = schedulerLoad;
const { terminate } = schedulerFinalize;
const { conversationNode, withAbortMark } = schedulerRecords;
const { toPromise } = bridge;
const { closedError } = util;

type Marked = {
  readonly result: "marked" | "terminal";
  readonly run?: schedulerTypesModule.Invocation | undefined;
};

const orphanIfBlocked = Effect.fnUntraced(function* (
  state: schedulerStateTypes.SchedulerState,
  tx: schedulerTypesModule.Transaction,
  current: schedulerTypesModule.RunnableTaskRecord,
) {
  yield* loadScopes(state, false);
  if (state.graph.hasOwnedLive(current.id)) return false;
  const resolution = state.resolve(current, state.options.registry.snapshot());
  if (resolution.kind !== "blocked") return false;
  yield* terminate(state, tx, current, { reason: resolution.reason, status: "orphaned" });
  return true;
});

const abortIn = Effect.fnUntraced(function* (
  state: schedulerStateTypes.SchedulerState,
  tx: schedulerTypesModule.Transaction,
  id: schedulerTypesModule.TaskId,
  keepRestart: boolean,
) {
  const current = yield* Effect.promise(() => tx.task(id));
  if (current === undefined) throw new Error(`Task ${id} does not exist`);
  if (current.state.status === "terminal") return { result: "terminal" } satisfies Marked;
  const invocation = state.invocations.get(id);
  if (keepRestart && current.abortReason === "restart")
    return { result: "marked" } satisfies Marked;
  if (invocation === undefined && current.state.status !== "completing") {
    if (yield* orphanIfBlocked(state, tx, current as schedulerTypesModule.RunnableTaskRecord))
      return { result: "marked" } satisfies Marked;
  }
  if (!current.abortRequested || current.abortReason !== undefined)
    tx.setTask(withAbortMark(current, undefined));
  return {
    result: "marked",
    run: invocation?.mode === "run" ? invocation : undefined,
  } satisfies Marked;
});

const abortTask = Effect.fnUntraced(function* (
  state: schedulerStateTypes.SchedulerState,
  id: schedulerTypesModule.TaskId,
  context: chordTypes.Context,
  keepRestart = false,
) {
  const { session } = state.options;
  const change = yield* toPromise((tx: schedulerTypesModule.Transaction): Effect.Effect<Marked> =>
    abortIn(state, tx, id, keepRestart),
  );
  const marked = yield* Effect.promise(() => session.commitWith(change, context));
  const { run } = marked;
  if (run !== undefined) {
    yield* Effect.promise(() =>
      awaitWithContext(Promise.race([run.done, session.failed]), context),
    );
  }
  return marked.result;
});

const waitForTask = Effect.fnUntraced(function* (
  state: schedulerStateTypes.SchedulerState,
  id: schedulerTypesModule.TaskId,
  context: chordTypes.Context,
) {
  const { session, storage } = state.options;
  const find = yield* toPromise(() =>
    Effect.gen(function* () {
      if (state.closing) throw closedError(session);
      if (state.graph.live.has(id)) return { promise: state.taskWaiters.add(id, context) };
      const record = yield* Effect.promise(() => storage.task(id, context));
      if (record === undefined) throw new Error(`Task ${id} does not exist`);
      return {
        promise: Promise.resolve(record as schedulerTypesModule.SettledTask<chordTypes.JsonValue>),
      };
    }),
  );
  const found = yield* Effect.promise(() => session.readOnLine(find));
  return yield* Effect.promise(() => found.promise);
});

const abortConversationIn = Effect.fnUntraced(function* (
  state: schedulerStateTypes.SchedulerState,
  tx: schedulerTypesModule.Transaction,
  conversationId: schedulerTypesModule.ConversationId,
  background: boolean,
) {
  const { graph } = state;
  const queued = yield* loadScopes(state, true);
  const scope = { conversation: conversationId };
  const reached: schedulerTypesModule.TaskId[] = [];
  const walk = graph.walkDown(conversationNode(conversationId), { crossBackground: background });
  for (const { node, live } of walk) {
    if (live === undefined || (node.background && !background)) continue;
    reached.push(live.id);
    if (!live.abortRequested || live.abortReason !== undefined)
      tx.setTask(withAbortMark(live, undefined));
  }
  for (const id of queued) {
    if (graph.inScope({ conversation: id }, scope, background) === true)
      yield* Effect.promise(() => state.options.withdrawInputs(tx, id));
  }
  return reached;
});

const abortConversation = Effect.fnUntraced(function* (
  state: schedulerStateTypes.SchedulerState,
  conversationId: schedulerTypesModule.ConversationId,
  background: boolean,
  context: chordTypes.Context,
) {
  const change = yield* toPromise((tx: schedulerTypesModule.Transaction) =>
    abortConversationIn(state, tx, conversationId, background),
  );
  const reached = yield* Effect.promise(() => state.options.session.commitWith(change, context));
  if (background) {
    yield* Effect.forEach(reached, (id) => waitForTask(state, id, context), { discard: true });
  }
  yield* Effect.promise(() => state.waitForIdle(conversationId, context));
});

const schedulerPublic = {
  abortConversation,
  abortTask,
  waitForTask,
};

export default schedulerPublic;
