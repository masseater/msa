import type { Context } from "@msa/chord";
import { Effect, Function } from "effect";

import {
  type AnyDocToken,
  checkRecordScope,
  checkRecordVersion,
  materializeDocument,
  type ResolvedAddress,
  resolveAddress,
} from "../documents.ts";
import type { Dual2, Dual3 } from "../dual.ts";
import { idFromNumber } from "../ids.ts";
import type { ConversationId, DocumentAddress, EntryId, JsonObject } from "../types.ts";
import { loadDocument, touchDocument } from "./session-documents.ts";
import { assertUsable, enqueueHealthy, type SessionState } from "./session-state.ts";
import type { LoadedDocument } from "./transaction-types.ts";

export type Resolved = {
  readonly definition: AnyDocToken["definition"];
  readonly resolved: ResolvedAddress;
  readonly context: Context;
};

export const resolveRead: Dual2<AnyDocToken, readonly unknown[], Resolved> = Function.dual(
  2,
  (token: AnyDocToken, args: readonly unknown[]): Resolved => {
    const definition = token.definition;
    const resolved = resolveAddress(definition, args);
    return { definition, resolved, context: args[resolved.nextArgument] as Context };
  },
);

export const loadResolved: Dual2<
  SessionState,
  Resolved,
  Effect.Effect<LoadedDocument | undefined>
> = Function.dual(2, (state: SessionState, read: Resolved) =>
  loadDocument(state, read.definition, read.resolved.id, read.resolved.address, read.context),
);

export const checked: Dual2<Resolved, LoadedDocument, LoadedDocument> = Function.dual(
  2,
  (read: Resolved, loaded: LoadedDocument): LoadedDocument => {
    checkRecordScope(read.definition, loaded.record);
    checkRecordVersion(read.definition, loaded.record, loaded.storedVersion);
    return loaded;
  },
);

export const conversationDocumentOnLine: Dual3<
  SessionState,
  AnyDocToken,
  readonly [ConversationId, Context],
  Effect.Effect<
    | {
        readonly record: LoadedDocument["record"];
        readonly version: number;
        readonly value: JsonObject;
      }
    | undefined
  >
> = Function.dual(
  3,
  Effect.fn("conversationDocumentOnLine")(function* (
    state: SessionState,
    token: AnyDocToken,
    args: readonly [ConversationId, Context],
  ) {
    const read = resolveRead(token, args);
    const loaded = yield* loadResolved(state, { ...read, context: args[1] });
    if (loaded === undefined) return undefined;
    checked(read, loaded);
    return { record: loaded.record, version: loaded.valueVersion, value: loaded.tracker.value };
  }),
);

export const snapshotDocument: Dual3<
  SessionState,
  AnyDocToken,
  readonly unknown[],
  Effect.Effect<JsonObject | undefined>
> = Function.dual(
  3,
  Effect.fn("snapshotDocument")(function* (
    state: SessionState,
    token: AnyDocToken,
    args: readonly unknown[],
  ) {
    assertUsable(state);
    const read = resolveRead(token, args);
    const cached = state.documents.get(read.resolved.id);
    const fresh = cached?.valueVersion === read.definition.version ? cached : undefined;
    if (fresh !== undefined) touchDocument(state, read.resolved.id);
    const loaded =
      fresh ?? (yield* Effect.promise(() => enqueueHealthy(state, loadResolved(state, read))));
    if (loaded === undefined) return undefined;
    return checked(read, loaded).tracker.value;
  }),
);

const historicalDocument = Effect.fn("historicalDocument")(function* (
  state: SessionState,
  read: Resolved,
  conversationId: ConversationId,
  at: EntryId,
) {
  const { storage } = state;
  const context = read.context;
  const storedEntry = yield* Effect.promise(() => storage.entry(conversationId, at, context));
  if (storedEntry === undefined) {
    throw new Error(`Entry ${at} is not visible from conversation ${conversationId}`);
  }
  const address: DocumentAddress = {
    ...read.resolved.address,
    scope: { kind: "conversation", conversationId: storedEntry.entry.conversationId },
  };
  const seq = storedEntry.commitSeq;
  const record = yield* Effect.promise(() => storage.findDocument(address, seq, context));
  if (record === undefined) return undefined;
  const stored = yield* Effect.promise(() => storage.document(record.id, seq, context));
  if (stored === undefined) {
    throw new Error(`Historical document ${record.id} (${record.kind}) cannot be read`);
  }
  return materializeDocument(read.definition, stored);
});

export const snapshotAsOf: Dual3<
  SessionState,
  AnyDocToken,
  readonly unknown[],
  Effect.Effect<JsonObject | undefined>
> = Function.dual(3, (state: SessionState, token: AnyDocToken, args: readonly unknown[]) =>
  Effect.suspend(() => {
    assertUsable(state);
    const definition = token.definition;
    const resolved = resolveAddress(definition, args);
    if (resolved.address.scope.kind !== "conversation") {
      throw new TypeError("Session.snapshotAsOf() requires a conversation document");
    }
    const conversationId = resolved.address.scope.conversationId;
    const atValue = args[resolved.nextArgument];
    if (typeof atValue !== "number" || !Number.isSafeInteger(atValue)) {
      throw new TypeError("Session.snapshotAsOf() requires an entry ID");
    }
    const at = idFromNumber<EntryId>(atValue);
    const read = { definition, resolved, context: args[resolved.nextArgument + 1] as Context };
    return Effect.promise(() =>
      enqueueHealthy(state, historicalDocument(state, read, conversationId, at)),
    );
  }),
);

export type { AnyDocToken };
