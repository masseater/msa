import type { Context, JsonValue } from "@msa/chord";
import { withAbortSignal } from "@msa/chord/context";
import { copyJson } from "@msa/chord/json";
import { Effect } from "effect";

import { promiseTry } from "../promise-try.ts";
import { type ContextRange, readContextFrom } from "./context.ts";
import { abortTask, waitForTask } from "./scheduler-public.ts";
import { endedError, sessionMethod } from "./scheduler-records.ts";
import type { SchedulerState } from "./scheduler-state.ts";
import type {
  AnyTaskRecord,
  ConversationId,
  EntryId,
  EntryRecord,
  ErasedRuntime,
  Invocation,
  TaskId,
  TaskOutcome,
} from "./scheduler-types.ts";

export type RuntimeParts = { readonly state: SchedulerState; readonly invocation: Invocation };

const ownedTasks = ({ state, invocation }: RuntimeParts, context: Context): AnyTaskRecord[] => {
  if (invocation.ended) throw endedError(invocation);
  context.abortSignal?.throwIfAborted();
  const owned: AnyTaskRecord[] = [];
  for (const node of state.graph.below.get(invocation.taskId) ?? []) {
    const record = typeof node === "string" ? undefined : state.graph.live.get(node);
    if (record?.owner === invocation.taskId) owned.push(record);
  }
  return owned
    .sort((a, b) => a.id - b.id)
    .map((record) => copyJson(record as unknown as JsonValue) as unknown as AnyTaskRecord);
};

const abortOwned = Effect.fnUntraced(function* (
  { state, invocation }: RuntimeParts,
  id: TaskId,
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
  state: SchedulerState,
  ids: readonly TaskId[],
  context: Context,
) {
  const found: TaskOutcome<JsonValue>[] = [];
  for (const id of ids) {
    const record = yield* Effect.promise(() => state.options.storage.task(id, context));
    const taskState = record?.state;
    if (taskState?.status !== "terminal") throw new Error(`Task ${id} is not terminal`);
    found.push(taskState.outcome);
  }
  return found;
});

const readEntry = Effect.fnUntraced(function* (
  { state, invocation }: RuntimeParts,
  token: { readonly kind: string } | undefined,
  id: EntryId,
  context: Context,
) {
  const { session, storage } = state.options;
  const found = yield* Effect.promise(() =>
    session.readOnLine(() => storage.entry(invocation.conversationId, id, context)),
  );
  const entry: EntryRecord | undefined = found?.entry;
  return token === undefined || entry?.kind === token.kind ? entry : undefined;
});

const keepContext = (
  { state, invocation }: RuntimeParts,
  conversationId: ConversationId,
  range: ContextRange | undefined,
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
    state.contexts.set(conversationId, { range, idleSince: undefined });
  } else if (state.contextRetentionMs() > 0) {
    state.contexts.set(conversationId, {
      range,
      idleSince: kept?.idleSince ?? state.options.now(),
    });
    state.scheduleExpiry();
  }
};

const readContext = Effect.fnUntraced(function* (
  parts: RuntimeParts,
  conversationId: ConversationId,
  context: Context,
  at: EntryId | undefined,
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

const sessionReads = (parts: RuntimeParts) => {
  const { state, invocation } = parts;
  const { session } = state.options;
  return {
    snapshot: ((...args: readonly unknown[]) =>
      state.read(invocation, () =>
        sessionMethod(session, "snapshot")(...args),
      )) as ErasedRuntime["snapshot"],
    snapshotAsOf: ((...args: readonly unknown[]) =>
      state.read(invocation, () =>
        sessionMethod(session, "snapshotAsOf")(...args),
      )) as ErasedRuntime["snapshotAsOf"],
    getTask: ((id: TaskId, context: Context) =>
      state.read(invocation, () =>
        session.readOnLine(() => state.options.storage.task(id, context)),
      )) as ErasedRuntime["getTask"],
    waitForTask: ((id: TaskId, context: Context) =>
      state.read(invocation, () =>
        Effect.runPromise(
          waitForTask(state, id, withAbortSignal(invocation.controller.signal, context)),
        ),
      )) as ErasedRuntime["waitForTask"],
  };
};

export const runtimeReads = (parts: RuntimeParts) => {
  const { state, invocation } = parts;
  const { session } = state.options;
  return {
    ...sessionReads(parts),
    ownedTasks: (context: Context) =>
      state.read(invocation, () =>
        session.readOnLine(() => promiseTry(() => ownedTasks(parts, context))),
      ),
    abortOwned: (id: TaskId, context: Context) =>
      state.read(invocation, () => Effect.runPromise(abortOwned(parts, id, context))),
    outcomes: ((ids: readonly TaskId[], context: Context) =>
      state.read(invocation, () =>
        session.readOnLine(() => Effect.runPromise(outcomes(state, ids, context))),
      )) as ErasedRuntime["outcomes"],
    conversation: (id: ConversationId, context: Context) =>
      state.read(invocation, () =>
        state.options.conversation(
          id,
          {
            signal: invocation.controller.signal,
            check: () => {
              if (invocation.ended) throw endedError(invocation);
            },
          },
          context,
        ),
      ),
    entry: ((...args: readonly unknown[]) => {
      const [token, id, context] =
        args.length === 2
          ? [undefined, args[0] as EntryId, args[1] as Context]
          : [args[0] as { readonly kind: string }, args[1] as EntryId, args[2] as Context];
      return state.read(invocation, () => Effect.runPromise(readEntry(parts, token, id, context)));
    }) as ErasedRuntime["entry"],
    context: (
      conversationId: ConversationId,
      context: Context,
      options?: { readonly at?: EntryId },
    ) =>
      state.read(invocation, () =>
        Effect.runPromise(readContext(parts, conversationId, context, options?.at)),
      ),
  };
};
