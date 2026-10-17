import type { Context, JsonValue } from "@msa/chord";
import { awaitWithContext } from "@msa/chord/context";
import { Effect } from "effect";

import { toPromise } from "./bridge.ts";
import { terminate } from "./scheduler-finalize.ts";
import { loadScopes } from "./scheduler-load.ts";
import { conversationNode, withAbortMark } from "./scheduler-records.ts";
import type { SchedulerState } from "./scheduler-state.ts";
import type {
  ConversationId,
  Invocation,
  RunnableTaskRecord,
  SettledTask,
  TaskId,
  Transaction,
} from "./scheduler-types.ts";
import { closedError } from "./util.ts";

type Marked = {
  readonly result: "marked" | "terminal";
  readonly run?: Invocation | undefined;
};

const orphanIfBlocked = Effect.fn("orphanIfBlocked")(function* (
  state: SchedulerState,
  tx: Transaction,
  current: RunnableTaskRecord,
) {
  yield* loadScopes(state, false);
  if (state.graph.hasOwnedLive(current.id)) return false;
  const resolution = state.resolve(current, state.options.registry.snapshot());
  if (resolution.kind !== "blocked") return false;
  yield* terminate(state, tx, current, { status: "orphaned", reason: resolution.reason });
  return true;
});

const abortIn = Effect.fn("abortTaskIn")(function* (
  state: SchedulerState,
  tx: Transaction,
  id: TaskId,
  keepRestart: boolean,
) {
  const current = yield* Effect.promise(() => tx.task(id));
  if (current === undefined) throw new Error(`Task ${id} does not exist`);
  if (current.state.status === "terminal") return { result: "terminal" } satisfies Marked;
  const invocation = state.invocations.get(id);
  if (keepRestart && current.abortReason === "restart")
    return { result: "marked" } satisfies Marked;
  if (invocation === undefined && current.state.status !== "completing") {
    if (yield* orphanIfBlocked(state, tx, current as RunnableTaskRecord))
      return { result: "marked" } satisfies Marked;
  }
  if (!current.abortRequested || current.abortReason !== undefined)
    tx.setTask(withAbortMark(current, undefined));
  return {
    result: "marked",
    run: invocation?.mode === "run" ? invocation : undefined,
  } satisfies Marked;
});

export const abortTask = Effect.fn("abortTask")(function* (
  state: SchedulerState,
  id: TaskId,
  context: Context,
  keepRestart = false,
) {
  const { session } = state.options;
  const change = yield* toPromise((tx: Transaction): Effect.Effect<Marked> =>
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

export const waitForTask = Effect.fn("waitForTask")(function* (
  state: SchedulerState,
  id: TaskId,
  context: Context,
) {
  const { session, storage } = state.options;
  const find = yield* toPromise(() =>
    Effect.gen(function* () {
      if (state.closing) throw closedError(session);
      if (state.graph.live.has(id)) return { promise: state.taskWaiters.add(id, context) };
      const record = yield* Effect.promise(() => storage.task(id, context));
      if (record === undefined) throw new Error(`Task ${id} does not exist`);
      return { promise: Promise.resolve(record as SettledTask<JsonValue>) };
    }),
  );
  const found = yield* Effect.promise(() => session.readOnLine(find));
  return yield* Effect.promise(() => found.promise);
});

const abortConversationIn = Effect.fn("abortConversationIn")(function* (
  state: SchedulerState,
  tx: Transaction,
  conversationId: ConversationId,
  background: boolean,
) {
  const { graph } = state;
  const queued = yield* loadScopes(state, true);
  const scope = { conversation: conversationId };
  const reached: TaskId[] = [];
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

export const abortConversation = Effect.fn("abortConversation")(function* (
  state: SchedulerState,
  conversationId: ConversationId,
  background: boolean,
  context: Context,
) {
  const change = yield* toPromise((tx: Transaction) =>
    abortConversationIn(state, tx, conversationId, background),
  );
  const reached = yield* Effect.promise(() => state.options.session.commitWith(change, context));
  if (background) {
    yield* Effect.forEach(reached, (id) => waitForTask(state, id, context), { discard: true });
  }
  yield* Effect.promise(() => state.waitForIdle(conversationId, context));
});
