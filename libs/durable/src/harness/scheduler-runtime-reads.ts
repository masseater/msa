import type { Context, JsonValue } from "@msa/chord";
import { withAbortSignal } from "@msa/chord/context";
import { copyJson } from "@msa/chord/json";
import { Effect } from "effect";

import promiseTryModule from "../promise-try.ts";
import contextModule from "./context.ts";
import schedulerPublic from "./scheduler-public.ts";
import schedulerRecords from "./scheduler-records.ts";
import type schedulerRuntimeReadsTypes from "./scheduler-runtime-reads.types.ts";
import type schedulerTypesModule from "./scheduler-types.types.ts";

const { endedError, sessionMethod } = schedulerRecords;
const { abortTask, waitForTask } = schedulerPublic;
const { readContextFrom } = contextModule;
const { promiseTry } = promiseTryModule;

const ownedTasks = (
  { state, invocation }: schedulerRuntimeReadsTypes.RuntimeParts,
  context: Context,
): schedulerTypesModule.AnyTaskRecord[] => {
  if (invocation.ended) throw endedError(invocation);
  context.abortSignal?.throwIfAborted();
  const owned: schedulerTypesModule.AnyTaskRecord[] = [];
  for (const node of state.graph.below.get(invocation.taskId) ?? []) {
    const record = typeof node === "string" ? undefined : state.graph.live.get(node);
    if (record?.owner === invocation.taskId) owned.push(record);
  }
  return owned
    .sort((a, b) => a.id - b.id)
    .map(
      (record) =>
        copyJson(record as unknown as JsonValue) as unknown as schedulerTypesModule.AnyTaskRecord,
    );
};

const abortOwned = Effect.fnUntraced(function* (
  { state, invocation }: schedulerRuntimeReadsTypes.RuntimeParts,
  id: schedulerTypesModule.TaskId,
  context: Context,
) {
  const bound = withAbortSignal(invocation.controller.signal, context);
  const { session, storage } = state.options;
  const record = yield* Effect.promise(() => session.readOnLine(() => storage.task(id, bound)));
  if (record?.owner !== invocation.taskId) {
    throw new Error(`Task ${id} is not owned by task ${invocation.taskId}`);
  }
  if (record.state.status === "terminal") return;
  yield* abortTask(state, id, bound, true);
  yield* waitForTask(state, id, bound);
});

const outcomes = Effect.fnUntraced(function* (
  state: schedulerRuntimeReadsTypes.SchedulerState,
  ids: readonly schedulerTypesModule.TaskId[],
  context: Context,
) {
  const found: schedulerTypesModule.TaskOutcome<JsonValue>[] = [];
  for (const id of ids) {
    const record = yield* Effect.promise(() => state.options.storage.task(id, context));
    const taskState = record?.state;
    if (taskState?.status !== "terminal") throw new Error(`Task ${id} is not terminal`);
    found.push(taskState.outcome);
  }
  return found;
});

const readEntry = Effect.fnUntraced(function* (
  { state, invocation }: schedulerRuntimeReadsTypes.RuntimeParts,
  token: { readonly kind: string } | undefined,
  id: schedulerTypesModule.EntryId,
  context: Context,
) {
  const { session, storage } = state.options;
  const found = yield* Effect.promise(() =>
    session.readOnLine(() => storage.entry(invocation.conversationId, id, context)),
  );
  const entry: schedulerTypesModule.EntryRecord | undefined = found?.entry;
  return token === undefined || entry?.kind === token.kind ? entry : undefined;
});

const keepContext = (
  { state, invocation }: schedulerRuntimeReadsTypes.RuntimeParts,
  conversationId: schedulerTypesModule.ConversationId,
  range: schedulerRuntimeReadsTypes.ContextRange | undefined,
): void => {
  const kept = state.contexts.get(conversationId);
  if (
    range === undefined ||
    state.closing ||
    invocation.ended ||
    (kept !== undefined && kept.range.bounds.tail > range.bounds.tail)
  )
    return;
  if (!state.graph.idle(conversationId)) {
    state.contexts.set(conversationId, { idleSince: undefined, range });
  } else if (state.contextRetentionMs() > 0) {
    state.contexts.set(conversationId, {
      idleSince: kept?.idleSince ?? state.options.now(),
      range,
    });
    state.scheduleExpiry();
  }
};

const readContext = Effect.fnUntraced(function* (
  parts: schedulerRuntimeReadsTypes.RuntimeParts,
  conversationId: schedulerTypesModule.ConversationId,
  context: Context,
  at: schedulerTypesModule.EntryId | undefined,
) {
  const { state } = parts;
  const { view, range } = yield* readContextFrom(
    state.options.session,
    state.options.storage,
    conversationId,
    context,
    at,
    state.contexts.get(conversationId)?.range,
  );
  keepContext(parts, conversationId, range);
  return view;
});

const sessionReads = (parts: schedulerRuntimeReadsTypes.RuntimeParts) => {
  const { state, invocation } = parts;
  const { session } = state.options;
  return {
    getTask: ((id: schedulerTypesModule.TaskId, context: Context) =>
      state.read(invocation, () =>
        session.readOnLine(() => state.options.storage.task(id, context)),
      )) as schedulerTypesModule.ErasedRuntime["getTask"],
    snapshot: ((...args: readonly unknown[]) =>
      state.read(invocation, () =>
        sessionMethod(session, "snapshot")(...args),
      )) as schedulerTypesModule.ErasedRuntime["snapshot"],
    snapshotAsOf: ((...args: readonly unknown[]) =>
      state.read(invocation, () =>
        sessionMethod(session, "snapshotAsOf")(...args),
      )) as schedulerTypesModule.ErasedRuntime["snapshotAsOf"],
    waitForTask: ((id: schedulerTypesModule.TaskId, context: Context) =>
      state.read(invocation, () =>
        Effect.runPromise(
          waitForTask(state, id, withAbortSignal(invocation.controller.signal, context)),
        ),
      )) as schedulerTypesModule.ErasedRuntime["waitForTask"],
  };
};

const runtimeReads = (parts: schedulerRuntimeReadsTypes.RuntimeParts) => {
  const { state, invocation } = parts;
  const { session } = state.options;
  return {
    ...sessionReads(parts),
    abortOwned: (id: schedulerTypesModule.TaskId, context: Context) =>
      state.read(invocation, () => Effect.runPromise(abortOwned(parts, id, context))),
    context: (
      conversationId: schedulerTypesModule.ConversationId,
      context: Context,
      options?: { readonly at?: schedulerTypesModule.EntryId },
    ) =>
      state.read(invocation, () =>
        Effect.runPromise(readContext(parts, conversationId, context, options?.at)),
      ),
    conversation: (id: schedulerTypesModule.ConversationId, context: Context) =>
      state.read(invocation, () =>
        state.options.conversation(
          id,
          {
            check: () => {
              if (invocation.ended) throw endedError(invocation);
            },
            signal: invocation.controller.signal,
          },
          context,
        ),
      ),
    entry: ((...args: readonly unknown[]) => {
      const [token, id, context] =
        args.length === 2
          ? [undefined, args[0] as schedulerTypesModule.EntryId, args[1] as Context]
          : [
              args[0] as { readonly kind: string },
              args[1] as schedulerTypesModule.EntryId,
              args[2] as Context,
            ];
      return state.read(invocation, () => Effect.runPromise(readEntry(parts, token, id, context)));
    }) as schedulerTypesModule.ErasedRuntime["entry"],
    outcomes: ((ids: readonly schedulerTypesModule.TaskId[], context: Context) =>
      state.read(invocation, () =>
        session.readOnLine(() => Effect.runPromise(outcomes(state, ids, context))),
      )) as schedulerTypesModule.ErasedRuntime["outcomes"],
    ownedTasks: (context: Context) =>
      state.read(invocation, () =>
        session.readOnLine(() => promiseTry(() => ownedTasks(parts, context))),
      ),
  };
};

const schedulerRuntimeReads = {
  runtimeReads,
};

export default schedulerRuntimeReads;
