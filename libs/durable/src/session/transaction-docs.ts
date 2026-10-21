import trackerModule from "@msa/chord/delta/tracker";
import type chordTypes from "@msa/chord/index.types";
import json from "@msa/chord/json";
import { Effect, Function } from "effect";

import documentsModule from "../documents.ts";
import type documentsTypes from "../documents.types.ts";
import type dualTypes from "../dual.ts";
import type typesModule from "../types.types.ts";
import transactionState from "./transaction-state.ts";
import type transactionTypesModule from "./transaction-types.types.ts";

const { copyJson } = json;
const { track: trackValue } = trackerModule;

const { assertOpen, assertTaskDocumentsOpen, currentTask, mintId, requireConversation, track } =
  transactionState;
const {
  checkRecordScope,
  checkRecordVersion,
  documentCreate,
  materializeDocumentValue,
  resolveAddress,
} = documentsModule;

const requireScope = Effect.fnUntraced(function* (
  state: transactionTypesModule.TxState,
  scope: typesModule.DocumentAddress["scope"],
) {
  if (scope.kind === "conversation") yield* requireConversation(state, scope.conversationId);
  if (scope.kind !== "task") return;
  const task = yield* currentTask(state, scope.taskId);
  if (task === undefined) throw new Error(`Task ${scope.taskId} does not exist`);
  if (task.state.status === "terminal") throw new Error(`Task ${scope.taskId} is terminal`);
});

const adoptLoaded = (
  entry: transactionTypesModule.DocumentEntry,
  definition: documentsTypes.AnyDocDefinition,
  loaded: transactionTypesModule.LoadedDocument,
): chordTypes.Draft<typesModule.JsonObject> => {
  checkRecordScope(definition, loaded.record);
  checkRecordVersion(definition, loaded.record, loaded.storedVersion);
  entry.target = { document: loaded, kind: "loaded" };
  entry.change = loaded.tracker.beginChange();
  return entry.change.state;
};

const acquire = Effect.fnUntraced(function* (
  state: transactionTypesModule.TxState,
  entry: transactionTypesModule.DocumentEntry,
  seed: chordTypes.JsonValue | undefined,
  skipLoad: boolean,
) {
  const definition = entry.definition!;
  const loaded = skipLoad
    ? undefined
    : yield* Effect.promise(() =>
        state.host.load(definition, entry.addressId, entry.address, state.context),
      );
  assertOpen(state);
  if (loaded !== undefined) return adoptLoaded(entry, definition, loaded);
  yield* requireScope(state, entry.address.scope);
  assertOpen(state);
  const value = copyJson(
    definition.family === true ? definition.initial(seed) : definition.initial(),
  ) as typesModule.JsonObject;
  const id = yield* mintId<typesModule.DocumentId>(state);
  assertOpen(state);
  const tracker = trackValue(value);
  entry.target = {
    kind: "created",
    record: documentCreate(definition, entry.address, id),
    tracker,
    version: definition.version,
  };
  entry.change = tracker.beginChange();
  return entry.change.state;
});

const acquireForkCopy = Effect.fnUntraced(function* (
  state: transactionTypesModule.TxState,
  entry: transactionTypesModule.DocumentEntry,
  definition: documentsTypes.AnyDocDefinition,
  target: transactionTypesModule.ForkCopyTarget,
) {
  const stored = yield* Effect.promise(() =>
    state.host.storage.document(target.source.id, target.source.at, state.context),
  );
  assertOpen(state);
  if (stored === undefined) {
    throw new Error(`Fork source document ${target.source.id} cannot be read`);
  }
  if (
    stored.record.scope.kind !== "conversation" ||
    stored.record.kind !== target.record.kind ||
    stored.record.key !== target.record.key ||
    stored.record.history !== target.record.history ||
    stored.record.fork !== target.record.fork
  ) {
    throw new Error(`Fork source document ${target.source.id} does not match the copied record`);
  }
  const value = materializeDocumentValue(definition, target.record, stored.version, stored.value);
  const tracker = trackValue(value);
  entry.definition = definition;
  entry.target = { kind: "created", record: target.record, tracker, version: definition.version };
  entry.change = tracker.beginChange();
  return entry.change.state;
});

const findRetirement = Effect.fnUntraced(function* (
  state: transactionTypesModule.TxState,
  entry: transactionTypesModule.DocumentEntry,
) {
  const record =
    state.host.cached(entry.addressId)?.record ??
    (yield* Effect.promise(() =>
      state.host.storage.findDocument(entry.address, "current", state.context),
    ));
  assertOpen(state);
  if (record === undefined) return;
  checkRecordScope(entry.definition!, record);
  entry.target = { kind: "retire-only", record };
});

const pushEntry = (
  state: transactionTypesModule.TxState,
  entry: transactionTypesModule.DocumentEntry,
): void => {
  state.documents.push(entry);
  state.latestDocumentByAddress.set(entry.addressId, entry);
};

const reuseLatest = (
  state: transactionTypesModule.TxState,
  latest: transactionTypesModule.DocumentEntry | undefined,
  definition: documentsTypes.AnyDocDefinition,
): Promise<chordTypes.Draft<typesModule.JsonObject>> | undefined => {
  if (latest === undefined || latest.retireOnCommit) return undefined;
  if (latest.draftPromise !== undefined) return latest.draftPromise;
  if (latest.target?.kind !== "fork-copy") return undefined;
  latest.draftPromise = track(
    state,
    Effect.runPromise(acquireForkCopy(state, latest, definition, latest.target)),
  );
  return latest.draftPromise;
};

const openDoc: dualTypes.Dual3<
  transactionTypesModule.TxState,
  documentsTypes.AnyDocToken,
  readonly unknown[],
  Promise<chordTypes.Draft<typesModule.JsonObject>>
> = Function.dual(
  3,
  (
    state: transactionTypesModule.TxState,
    token: documentsTypes.AnyDocToken,
    args: readonly unknown[],
  ): Promise<chordTypes.Draft<typesModule.JsonObject>> => {
    try {
      assertOpen(state);
      const definition = token.definition;
      const resolved = resolveAddress(definition, args);
      assertTaskDocumentsOpen(state, resolved);
      const latest = state.latestDocumentByAddress.get(resolved.id);
      const reused = reuseLatest(state, latest, definition);
      if (reused !== undefined) return reused;
      const seed = definition.family === true ? copyJson(args[resolved.nextArgument]) : undefined;
      const docEntry: transactionTypesModule.DocumentEntry = {
        address: resolved.address,
        addressId: resolved.id,
        definition,
        retireOnCommit: false,
      };
      pushEntry(state, docEntry);
      docEntry.draftPromise = track(
        state,
        Effect.runPromise(acquire(state, docEntry, seed, latest?.retireOnCommit === true)),
      );
      return docEntry.draftPromise;
    } catch (error) {
      return Promise.reject(error);
    }
  },
);

const retireLatest = (
  state: transactionTypesModule.TxState,
  latest: transactionTypesModule.DocumentEntry,
  definition: documentsTypes.AnyDocDefinition,
): Promise<void> | undefined => {
  if (latest.retireOnCommit) return Promise.resolve();
  if (latest.target?.kind === "fork-copy") {
    checkRecordScope(definition, latest.target.record);
    latest.retireOnCommit = true;
    return Promise.resolve();
  }
  if (latest.draftPromise === undefined) return undefined;
  latest.retireOnCommit = true;
  return track(
    state,
    latest.draftPromise.then(() => undefined),
  );
};

const retireDoc: dualTypes.Dual3<
  transactionTypesModule.TxState,
  documentsTypes.AnyDocToken,
  readonly unknown[],
  Promise<void>
> = Function.dual(
  3,
  (
    state: transactionTypesModule.TxState,
    token: documentsTypes.AnyDocToken,
    args: readonly unknown[],
  ): Promise<void> => {
    try {
      assertOpen(state);
      const definition = token.definition;
      const resolved = resolveAddress(definition, args);
      const latest = state.latestDocumentByAddress.get(resolved.id);
      const retired = latest === undefined ? undefined : retireLatest(state, latest, definition);
      if (retired !== undefined) return retired;
      const entry: transactionTypesModule.DocumentEntry = {
        address: resolved.address,
        addressId: resolved.id,
        definition,
        retireOnCommit: true,
      };
      pushEntry(state, entry);
      return track(state, Effect.runPromise(findRetirement(state, entry)));
    } catch (error) {
      return Promise.reject(error);
    }
  },
);

const transactionDocs = {
  openDoc,
  retireDoc,
};

export default transactionDocs;
