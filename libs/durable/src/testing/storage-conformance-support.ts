import contextModule from "@msa/chord/context";
import type chordTypes from "@msa/chord/index.types";
import { Cause, Effect, Exit, Function, Schema } from "effect";

import types from "../types.ts";
import type typesModule from "../types.types.ts";
import type storageConformanceSupportTypes from "./storage-conformance-support.types.ts";
import type typesModuleModule from "./types.ts";

const { BACKGROUND_CONTEXT } = contextModule;

const { ROOT_CONVERSATION_ID } = types;

const context = BACKGROUND_CONTEXT;

const io = <A>(operation: () => Promise<A>): Effect.Effect<A> => Effect.promise(operation);

const mint = <I extends typesModule.Id<string>>(storage: typesModule.Storage): Effect.Effect<I> =>
  io(() => storage.mintId<I>());

const commit = Effect.fnUntraced(function* (
  storage: typesModule.Storage,
  writes: readonly typesModule.StorageWrite[],
) {
  return yield* io(() => storage.commit(writes, context));
});

const createRoot = (storage: typesModule.Storage): Effect.Effect<typesModule.ConversationId> =>
  Effect.as(
    commit(storage, [{ type: "conversation", value: { id: ROOT_CONVERSATION_ID } }]),
    ROOT_CONVERSATION_ID,
  );

const isDataFirst = (args: IArguments): boolean => typeof args[1] === "number";

const storedPendingTask = (
  id: typesModule.TaskId<chordTypes.JsonValue>,
  conversationId: typesModule.ConversationId,
  phase = "ready",
) =>
  ({
    abortRequested: false,
    background: false,
    conversationId,
    id,
    input: { value: id },
    kind: "test.task",
    state: { checkpoint: { phase }, status: "pending" },
    version: 1,
  }) satisfies storageConformanceSupportTypes.StoredTask;

type PendingTask = ReturnType<typeof storedPendingTask>;

const pendingTask: {
  (
    conversationId: typesModule.ConversationId,
    phase?: string,
  ): (id: typesModule.TaskId<chordTypes.JsonValue>) => PendingTask;
  (
    id: typesModule.TaskId<chordTypes.JsonValue>,
    conversationId: typesModule.ConversationId,
    phase?: string,
  ): PendingTask;
} = Function.dual(isDataFirst, storedPendingTask);

const entry: {
  (
    conversationId: typesModule.ConversationId,
    kind?: string,
    extra?: Partial<typesModule.EntryRecord>,
  ): (id: typesModule.EntryId) => typesModule.EntryRecord;
  (
    id: typesModule.EntryId,
    conversationId: typesModule.ConversationId,
    kind?: string,
    extra?: Partial<typesModule.EntryRecord>,
  ): typesModule.EntryRecord;
} = Function.dual(
  isDataFirst,
  (
    id: typesModule.EntryId,
    conversationId: typesModule.ConversationId,
    kind = "message",
    extra: Partial<typesModule.EntryRecord> = {},
  ): typesModule.EntryRecord => ({ conversationId, id, kind, ...extra }),
);

const jsonString = Schema.fromJsonString(Schema.Unknown);

const parseJson = (text: string): Effect.Effect<unknown> =>
  Effect.orDie(Schema.decodeEffect(jsonString)(text));

const roundTripJson = (value: unknown): Effect.Effect<unknown> =>
  Effect.flatMap(Effect.orDie(Schema.encodeEffect(jsonString)(value)), parseJson);

const assertionFacade =
  (
    assertions: typesModuleModule.StorageConformanceAssertions,
  ): storageConformanceSupportTypes.Expect =>
  (actual) => ({
    rejects: {
      toThrow: (messageIncludes) =>
        io(() => assertions.rejects(Promise.resolve(actual), messageIncludes)),
    },
    toBe: (expected) => assertions.strictEqual(actual, expected),
    toBeDefined: () => assertions.ok(actual !== undefined, "Expected value to be defined"),
    toBeGreaterThan: (expected) => assertions.greaterThan(actual as number, expected),
    toBeUndefined: () => assertions.strictEqual(actual, undefined),
    toEqual: (expected) => assertions.deepEqual(actual, expected),
    toHaveLength: (expected) =>
      assertions.strictEqual((actual as { readonly length: unknown }).length, expected),
    toMatchObject: (expected) => assertions.partialDeepEqual(actual, expected),
  });

const documentAt = Effect.fnUntraced(function* (
  storage: typesModule.Storage,
  id: typesModule.DocumentId,
  at: Parameters<typesModule.Storage["document"]>[1],
) {
  return yield* io(() => storage.document(id, at, context));
});

const documentIds = Effect.fnUntraced(function* (
  storage: typesModule.Storage,
  query: Parameters<typesModule.Storage["scanDocuments"]>[0],
) {
  const page = yield* io(() => storage.scanDocuments(query, 10, undefined, context));
  return page.items.map(({ id }) => id);
});

const failureOf = <A>(effect: Effect.Effect<A>): Effect.Effect<unknown> =>
  Effect.map(Effect.exit(effect), (exit) =>
    Exit.isFailure(exit) ? Cause.squash(exit.cause) : undefined,
  );

const storageConformanceSupport = {
  assertionFacade,
  commit,
  context,
  createRoot,
  documentAt,
  documentIds,
  entry,
  failureOf,
  io,
  mint,
  parseJson,
  pendingTask,
  roundTripJson,
};

export default storageConformanceSupport;
