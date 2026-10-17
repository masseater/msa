import { copyJson, type Draft, type JsonValue } from "@msa/chord";
import { track as trackValue } from "@msa/chord/delta";
import { Effect, Function } from "effect";

import {
  type AnyDocDefinition,
  type AnyDocToken,
  checkRecordScope,
  checkRecordVersion,
  documentCreate,
  materializeDocumentValue,
  resolveAddress,
} from "../documents.ts";
import type { Dual3 } from "../dual.ts";
import type { DocumentAddress, DocumentId, JsonObject } from "../types.ts";
import {
  assertOpen,
  assertTaskDocumentsOpen,
  currentTask,
  mintId,
  requireConversation,
  track,
} from "./transaction-state.ts";
import type {
  DocumentEntry,
  ForkCopyTarget,
  LoadedDocument,
  TxState,
} from "./transaction-types.ts";

const requireScope = Effect.fn("requireScope")(function* (
  state: TxState,
  scope: DocumentAddress["scope"],
) {
  if (scope.kind === "conversation") yield* requireConversation(state, scope.conversationId);
  if (scope.kind !== "task") return;
  const task = yield* currentTask(state, scope.taskId);
  if (task === undefined) throw new Error(`Task ${scope.taskId} does not exist`);
  if (task.state.status === "terminal") throw new Error(`Task ${scope.taskId} is terminal`);
});

const adoptLoaded = (
  entry: DocumentEntry,
  definition: AnyDocDefinition,
  loaded: LoadedDocument,
): Draft<JsonObject> => {
  checkRecordScope(definition, loaded.record);
  checkRecordVersion(definition, loaded.record, loaded.storedVersion);
  entry.target = { kind: "loaded", document: loaded };
  entry.change = loaded.tracker.beginChange();
  return entry.change.state;
};

const acquire = Effect.fn("acquire")(function* (
  state: TxState,
  entry: DocumentEntry,
  seed: JsonValue | undefined,
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
  ) as JsonObject;
  const id = yield* mintId<DocumentId>(state);
  assertOpen(state);
  const tracker = trackValue(value);
  entry.target = {
    kind: "created",
    record: documentCreate(definition, entry.address, id),
    version: definition.version,
    tracker,
  };
  entry.change = tracker.beginChange();
  return entry.change.state;
});

const acquireForkCopy = Effect.fn("acquireForkCopy")(function* (
  state: TxState,
  entry: DocumentEntry,
  definition: AnyDocDefinition,
  target: ForkCopyTarget,
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
  entry.target = { kind: "created", record: target.record, version: definition.version, tracker };
  entry.change = tracker.beginChange();
  return entry.change.state;
});

const findRetirement = Effect.fn("findRetirement")(function* (
  state: TxState,
  entry: DocumentEntry,
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

const pushEntry = (state: TxState, entry: DocumentEntry): void => {
  state.documents.push(entry);
  state.latestDocumentByAddress.set(entry.addressId, entry);
};

const reuseLatest = (
  state: TxState,
  latest: DocumentEntry | undefined,
  definition: AnyDocDefinition,
): Promise<Draft<JsonObject>> | undefined => {
  if (latest === undefined || latest.retireOnCommit) return undefined;
  if (latest.draftPromise !== undefined) return latest.draftPromise;
  if (latest.target?.kind !== "fork-copy") return undefined;
  latest.draftPromise = track(
    state,
    Effect.runPromise(acquireForkCopy(state, latest, definition, latest.target)),
  );
  return latest.draftPromise;
};

export const openDoc: Dual3<
  TxState,
  AnyDocToken,
  readonly unknown[],
  Promise<Draft<JsonObject>>
> = Function.dual(
  3,
  (state: TxState, token: AnyDocToken, args: readonly unknown[]): Promise<Draft<JsonObject>> => {
    try {
      assertOpen(state);
      const definition = token.definition;
      const resolved = resolveAddress(definition, args);
      assertTaskDocumentsOpen(state, resolved);
      const latest = state.latestDocumentByAddress.get(resolved.id);
      const reused = reuseLatest(state, latest, definition);
      if (reused !== undefined) return reused;
      const seed = definition.family === true ? copyJson(args[resolved.nextArgument]) : undefined;
      const docEntry: DocumentEntry = {
        addressId: resolved.id,
        address: resolved.address,
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
  state: TxState,
  latest: DocumentEntry,
  definition: AnyDocDefinition,
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

export const retireDoc: Dual3<
  TxState,
  AnyDocToken,
  readonly unknown[],
  Promise<void>
> = Function.dual(
  3,
  (state: TxState, token: AnyDocToken, args: readonly unknown[]): Promise<void> => {
    try {
      assertOpen(state);
      const definition = token.definition;
      const resolved = resolveAddress(definition, args);
      const latest = state.latestDocumentByAddress.get(resolved.id);
      const retired = latest === undefined ? undefined : retireLatest(state, latest, definition);
      if (retired !== undefined) return retired;
      const entry: DocumentEntry = {
        addressId: resolved.id,
        address: resolved.address,
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
