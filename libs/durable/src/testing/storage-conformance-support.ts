import type { JsonValue } from "@msa/chord";
import { BACKGROUND_CONTEXT } from "@msa/chord/context";
import { Cause, Effect, Exit, Function, Schema } from "effect";

import {
  type ConversationId,
  type DocumentId,
  type EntryId,
  type EntryRecord,
  type Id,
  ROOT_CONVERSATION_ID,
  type Storage,
  type StorageWrite,
  type TaskId,
  type TaskRecord,
} from "../types.ts";
import type { StorageConformanceAssertions } from "./types.ts";

export const context = BACKGROUND_CONTEXT;
export type StoredTask = TaskRecord<JsonValue, JsonValue, JsonValue>;
export type Identified = { readonly id: number };

export const io = <A>(operation: () => Promise<A>): Effect.Effect<A> => Effect.promise(operation);

export const mint = <I extends Id<string>>(storage: Storage): Effect.Effect<I> =>
  io(() => storage.mintId<I>());

export const commit = Effect.fnUntraced(function* (
  storage: Storage,
  writes: readonly StorageWrite[],
) {
  return yield* io(() => storage.commit(writes, context));
});

export const createRoot = (storage: Storage): Effect.Effect<ConversationId> =>
  Effect.as(
    commit(storage, [{ type: "conversation", value: { id: ROOT_CONVERSATION_ID } }]),
    ROOT_CONVERSATION_ID,
  );

const isDataFirst = (args: IArguments): boolean => typeof args[1] === "number";

const storedPendingTask = (
  id: TaskId<JsonValue>,
  conversationId: ConversationId,
  phase = "ready",
) =>
  ({
    id,
    conversationId,
    kind: "test.task",
    version: 1,
    input: { value: id },
    state: { status: "pending", checkpoint: { phase } },
    background: false,
    abortRequested: false,
  }) satisfies StoredTask;

type PendingTask = ReturnType<typeof storedPendingTask>;

export const pendingTask: {
  (conversationId: ConversationId, phase?: string): (id: TaskId<JsonValue>) => PendingTask;
  (id: TaskId<JsonValue>, conversationId: ConversationId, phase?: string): PendingTask;
} = Function.dual(isDataFirst, storedPendingTask);

export const entry: {
  (
    conversationId: ConversationId,
    kind?: string,
    extra?: Partial<EntryRecord>,
  ): (id: EntryId) => EntryRecord;
  (
    id: EntryId,
    conversationId: ConversationId,
    kind?: string,
    extra?: Partial<EntryRecord>,
  ): EntryRecord;
} = Function.dual(
  isDataFirst,
  (
    id: EntryId,
    conversationId: ConversationId,
    kind = "message",
    extra: Partial<EntryRecord> = {},
  ): EntryRecord => ({ id, conversationId, kind, ...extra }),
);

const jsonString = Schema.fromJsonString(Schema.Unknown);

export const parseJson = (text: string): Effect.Effect<unknown> =>
  Effect.orDie(Schema.decodeEffect(jsonString)(text));

export const roundTripJson = (value: unknown): Effect.Effect<unknown> =>
  Effect.flatMap(Effect.orDie(Schema.encodeEffect(jsonString)(value)), parseJson);

type AssertionResult = {
  toBe(expected: unknown): void;
  toBeDefined(): void;
  toBeGreaterThan(expected: number): void;
  toBeUndefined(): void;
  toEqual(expected: unknown): void;
  toHaveLength(expected: number): void;
  toMatchObject(expected: unknown): void;
  readonly rejects: { toThrow(messageIncludes: string): Effect.Effect<void> };
};

export type Expect = (actual: unknown) => AssertionResult;

export const assertionFacade =
  (assertions: StorageConformanceAssertions): Expect =>
  (actual) => ({
    toBe: (expected) => assertions.strictEqual(actual, expected),
    toBeDefined: () => assertions.ok(actual !== undefined, "Expected value to be defined"),
    toBeGreaterThan: (expected) => assertions.greaterThan(actual as number, expected),
    toBeUndefined: () => assertions.strictEqual(actual, undefined),
    toEqual: (expected) => assertions.deepEqual(actual, expected),
    toHaveLength: (expected) =>
      assertions.strictEqual((actual as { readonly length: unknown }).length, expected),
    toMatchObject: (expected) => assertions.partialDeepEqual(actual, expected),
    rejects: {
      toThrow: (messageIncludes) =>
        io(() => assertions.rejects(Promise.resolve(actual), messageIncludes)),
    },
  });

export const documentAt = Effect.fnUntraced(function* (
  storage: Storage,
  id: DocumentId,
  at: Parameters<Storage["document"]>[1],
) {
  return yield* io(() => storage.document(id, at, context));
});

export const documentIds = Effect.fnUntraced(function* (
  storage: Storage,
  query: Parameters<Storage["scanDocuments"]>[0],
) {
  const page = yield* io(() => storage.scanDocuments(query, 10, undefined, context));
  return page.items.map(({ id }) => id);
});

export const failureOf = <A>(effect: Effect.Effect<A>): Effect.Effect<unknown> =>
  Effect.map(Effect.exit(effect), (exit) =>
    Exit.isFailure(exit) ? Cause.squash(exit.cause) : undefined,
  );

export interface StorageCaseSpec {
  readonly name: string;
  readonly test: (storage: Storage, expect: Expect) => Effect.Effect<void>;
}
