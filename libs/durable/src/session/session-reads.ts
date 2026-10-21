import type chordTypes from "@msa/chord/index.types";
import { Effect, Function } from "effect";

import documentsModule from "../documents.ts";
import type documentsTypes from "../documents.types.ts";
import type dualTypes from "../dual.ts";
import ids from "../ids.ts";
import type typesModule from "../types.types.ts";
import sessionDocuments from "./session-documents.ts";
import type sessionReadsTypes from "./session-reads.types.ts";
import sessionState from "./session-state.ts";

const { checkRecordScope, checkRecordVersion, materializeDocument, resolveAddress } =
  documentsModule;
const { loadDocument, touchDocument } = sessionDocuments;
const { assertUsable, enqueueHealthy } = sessionState;
const { idFromNumber } = ids;

const resolveRead: dualTypes.Dual2<
  documentsTypes.AnyDocToken,
  readonly unknown[],
  sessionReadsTypes.Resolved
> = Function.dual(
  2,
  (token: documentsTypes.AnyDocToken, args: readonly unknown[]): sessionReadsTypes.Resolved => {
    const definition = token.definition;
    const resolved = resolveAddress(definition, args);
    return { context: args[resolved.nextArgument] as chordTypes.Context, definition, resolved };
  },
);

const loadResolved: dualTypes.Dual2<
  sessionReadsTypes.SessionState,
  sessionReadsTypes.Resolved,
  Effect.Effect<sessionReadsTypes.LoadedDocument | undefined>
> = Function.dual(2, (state: sessionReadsTypes.SessionState, read: sessionReadsTypes.Resolved) =>
  loadDocument(state, read.definition, read.resolved.id, read.resolved.address, read.context),
);

const checked: dualTypes.Dual2<
  sessionReadsTypes.Resolved,
  sessionReadsTypes.LoadedDocument,
  sessionReadsTypes.LoadedDocument
> = Function.dual(
  2,
  (
    read: sessionReadsTypes.Resolved,
    loaded: sessionReadsTypes.LoadedDocument,
  ): sessionReadsTypes.LoadedDocument => {
    checkRecordScope(read.definition, loaded.record);
    checkRecordVersion(read.definition, loaded.record, loaded.storedVersion);
    return loaded;
  },
);

const conversationDocumentOnLine: dualTypes.Dual3<
  sessionReadsTypes.SessionState,
  documentsTypes.AnyDocToken,
  readonly [typesModule.ConversationId, chordTypes.Context],
  Effect.Effect<
    | {
        readonly record: sessionReadsTypes.LoadedDocument["record"];
        readonly version: number;
        readonly value: typesModule.JsonObject;
      }
    | undefined
  >
> = Function.dual(
  3,
  Effect.fnUntraced(function* (
    state: sessionReadsTypes.SessionState,
    token: documentsTypes.AnyDocToken,
    args: readonly [typesModule.ConversationId, chordTypes.Context],
  ) {
    const read = resolveRead(token, args);
    const loaded = yield* loadResolved(state, { ...read, context: args[1] });
    if (loaded === undefined) return undefined;
    checked(read, loaded);
    return { record: loaded.record, value: loaded.tracker.value, version: loaded.valueVersion };
  }),
);

const snapshotDocument: dualTypes.Dual3<
  sessionReadsTypes.SessionState,
  documentsTypes.AnyDocToken,
  readonly unknown[],
  Effect.Effect<typesModule.JsonObject | undefined>
> = Function.dual(
  3,
  Effect.fnUntraced(function* (
    state: sessionReadsTypes.SessionState,
    token: documentsTypes.AnyDocToken,
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

const historicalDocument = Effect.fnUntraced(function* (
  state: sessionReadsTypes.SessionState,
  read: sessionReadsTypes.Resolved,
  conversationId: typesModule.ConversationId,
  at: typesModule.EntryId,
) {
  const { storage } = state;
  const context = read.context;
  const storedEntry = yield* Effect.promise(() => storage.entry(conversationId, at, context));
  if (storedEntry === undefined) {
    throw new Error(`Entry ${at} is not visible from conversation ${conversationId}`);
  }
  const address: typesModule.DocumentAddress = {
    ...read.resolved.address,
    scope: { conversationId: storedEntry.entry.conversationId, kind: "conversation" },
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

const snapshotAsOf: dualTypes.Dual3<
  sessionReadsTypes.SessionState,
  documentsTypes.AnyDocToken,
  readonly unknown[],
  Effect.Effect<typesModule.JsonObject | undefined>
> = Function.dual(
  3,
  (
    state: sessionReadsTypes.SessionState,
    token: documentsTypes.AnyDocToken,
    args: readonly unknown[],
  ) =>
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
      const at = idFromNumber<typesModule.EntryId>(atValue);
      const read = {
        context: args[resolved.nextArgument + 1] as chordTypes.Context,
        definition,
        resolved,
      };
      return Effect.promise(() =>
        enqueueHealthy(state, historicalDocument(state, read, conversationId, at)),
      );
    }),
);

const sessionReads = {
  checked,
  conversationDocumentOnLine,
  loadResolved,
  resolveRead,
  snapshotAsOf,
  snapshotDocument,
};

export default sessionReads;
