import type deltaTypes from "@msa/chord/delta.types";
import applyModule from "@msa/chord/delta/apply";
import { Effect, Function } from "effect";

import errors from "../../errors.ts";
import ids from "../../ids.ts";
import type typesModule from "../../types.types.ts";
import codec from "./codec.ts";
import type codecTypes from "./codec.types.ts";
import type databaseTypes from "./database.ts";
import scans from "./scans.ts";

const { apply } = applyModule;

const { recordById } = scans;
const { addressKey, addressParts, isAliveAt, isCurrentOnly, parseJson } = codec;
const { StorageRequestError } = errors;
const { idFromNumber } = ids;

const readRevisions = Effect.fnUntraced(function* (
  executor: databaseTypes.SqliteExecutor,
  id: typesModule.DocumentId,
  upper: number,
) {
  const base = yield* Effect.promise(() =>
    executor.get<codecTypes.RevisionRow>(
      `SELECT seq, kind, version, content FROM document_revisions
				WHERE document_id = ? AND kind = 'base' AND seq <= ? ORDER BY seq DESC LIMIT 1`,
      id,
      upper,
    ),
  );
  if (base === undefined) throw new Error(`Document ${id} is missing a required base`);
  const tail = yield* Effect.promise(() =>
    executor.all<codecTypes.RevisionRow>(
      `SELECT seq, kind, version, content FROM document_revisions
				WHERE document_id = ? AND seq > ? AND seq <= ? ORDER BY seq`,
      id,
      base.seq,
      upper,
    ),
  );
  return { base, tail };
});

const materializeDocument: {
  (
    id: typesModule.DocumentId,
    at: typesModule.DocumentPoint,
  ): (
    executor: databaseTypes.SqliteExecutor,
  ) => Effect.Effect<typesModule.StoredDocument | undefined>;
  (
    executor: databaseTypes.SqliteExecutor,
    id: typesModule.DocumentId,
    at: typesModule.DocumentPoint,
  ): Effect.Effect<typesModule.StoredDocument | undefined>;
} = Function.dual(
  3,
  Effect.fnUntraced(function* (
    executor: databaseTypes.SqliteExecutor,
    id: typesModule.DocumentId,
    at: typesModule.DocumentPoint,
  ) {
    const record = yield* Effect.promise(() =>
      recordById<typesModule.DocumentRecord>(executor, "documents", id),
    );
    if (record === undefined) return undefined;
    if (at !== "current" && isCurrentOnly(record)) {
      throw new StorageRequestError(`Document ${id} does not retain historical content`);
    }
    if (!isAliveAt(record, at)) return undefined;
    const { base, tail } = yield* readRevisions(
      executor,
      id,
      at === "current" ? Number.MAX_SAFE_INTEGER : at,
    );
    let value = parseJson<typesModule.JsonObject>(base.content);
    for (const revision of tail) {
      if (revision.kind !== "delta" || revision.version !== base.version) {
        throw new Error(`Document ${id} crosses a stored version boundary without a base`);
      }
      value = apply(
        value,
        parseJson<readonly deltaTypes.Op[]>(revision.content),
      ) as typesModule.JsonObject;
    }
    return { deltasSinceBase: tail.length, record, value, version: base.version };
  }),
);

type DocumentWrite = Extract<
  typesModule.StorageWrite,
  { type: "document.create" | "document.copy" | "document.change" | "document.retire" }
>;

const isDocumentWrite = (write: typesModule.StorageWrite): write is DocumentWrite =>
  write.type === "document.create" ||
  write.type === "document.copy" ||
  write.type === "document.change" ||
  write.type === "document.retire";

const assertOneContent = (
  action: codecTypes.DocumentAction,
  id: typesModule.DocumentId,
  create: boolean,
): void => {
  if (
    (create && action.create !== undefined) ||
    action.content !== undefined ||
    action.copy !== undefined
  ) {
    throw new Error(`Document ${id} has more than one content command`);
  }
};

const addDocumentWrite = (
  action: codecTypes.DocumentAction,
  write: DocumentWrite,
  id: typesModule.DocumentId,
): void => {
  switch (write.type) {
    case "document.create":
      assertOneContent(action, id, true);
      action.create = write.record;
      action.content = write.content;
      break;
    case "document.copy":
      assertOneContent(action, id, true);
      action.create = write.record;
      action.copy = write.source;
      break;
    case "document.change":
      assertOneContent(action, id, false);
      action.content = write.content;
      break;
    case "document.retire":
      if (action.retire) throw new Error(`Document ${id} is retired more than once`);
      action.retire = true;
      break;
  }
};

const prepareDocumentActions = (
  writes: readonly typesModule.StorageWrite[],
): Map<typesModule.DocumentId, codecTypes.DocumentAction> => {
  const actions = new Map<typesModule.DocumentId, codecTypes.DocumentAction>();
  for (const write of writes) {
    if (!isDocumentWrite(write)) continue;
    const id =
      write.type === "document.create" || write.type === "document.copy"
        ? write.record.id
        : write.id;
    let action = actions.get(id);
    if (action === undefined) {
      action = { retire: false };
      actions.set(id, action);
    }
    addDocumentWrite(action, write, id);
  }
  return actions;
};

const currentDocumentId = Effect.fnUntraced(function* (
  executor: databaseTypes.SqliteExecutor,
  address: typesModule.DocumentAddress | typesModule.DocumentCreate | typesModule.DocumentRecord,
) {
  const parts = addressParts(address);
  const row = yield* Effect.promise(() =>
    executor.get<codecTypes.IdRow>(
      `SELECT id FROM documents
				WHERE kind = ? AND scope_kind = ? AND owner_id = ? AND family = ? AND key_value = ? AND retired_at IS NULL
				LIMIT 1`,
      parts.kind,
      parts.scopeKind,
      parts.ownerId,
      parts.family,
      parts.keyValue,
    ),
  );
  return row?.id === undefined ? undefined : idFromNumber<typesModule.DocumentId>(row.id);
});

const checkDelta = Effect.fnUntraced(function* (
  executor: databaseTypes.SqliteExecutor,
  id: typesModule.DocumentId,
  action: codecTypes.DocumentAction,
) {
  if (action.content?.kind !== "delta") return;
  const version = action.content.version;
  const previous = yield* Effect.promise(() =>
    executor.get<{ readonly version: number }>(
      "SELECT version FROM document_revisions WHERE document_id = ? ORDER BY seq DESC LIMIT 1",
      id,
    ),
  );
  if (previous === undefined) throw new Error(`Document ${id} delta has no base`);
  if (previous.version !== version) {
    throw new Error(`Document ${id} version transition requires a base`);
  }
});

const checkDocumentAction = Effect.fnUntraced(function* (
  executor: databaseTypes.SqliteExecutor,
  actions: ReadonlyMap<typesModule.DocumentId, codecTypes.DocumentAction>,
  id: typesModule.DocumentId,
  action: codecTypes.DocumentAction,
) {
  if (action.copy !== undefined && actions.has(action.copy.id)) {
    throw new Error(`Document copy ${id} source is changed in the copy batch`);
  }
  const existing = yield* Effect.promise(() =>
    recordById<typesModule.DocumentRecord>(executor, "documents", id),
  );
  if (action.create === undefined && existing === undefined)
    throw new Error(`Unknown document: ${id}`);
  if (action.create !== undefined && existing !== undefined)
    throw new Error(`Document ${id} already exists`);
  if (existing?.retiredAt !== undefined) throw new Error(`Document ${id} is retired`);
  yield* checkDelta(executor, id, action);
  return { existing, record: action.create ?? existing! };
});

const checkDocumentActions: {
  (
    actions: ReadonlyMap<typesModule.DocumentId, codecTypes.DocumentAction>,
  ): (executor: databaseTypes.SqliteExecutor) => Effect.Effect<void>;
  (
    executor: databaseTypes.SqliteExecutor,
    actions: ReadonlyMap<typesModule.DocumentId, codecTypes.DocumentAction>,
  ): Effect.Effect<void>;
} = Function.dual(
  2,
  Effect.fnUntraced(function* (
    executor: databaseTypes.SqliteExecutor,
    actions: ReadonlyMap<typesModule.DocumentId, codecTypes.DocumentAction>,
  ) {
    const liveCounts = new Map<string, number>();
    for (const [id, action] of actions) {
      const { record, existing } = yield* checkDocumentAction(executor, actions, id, action);
      const key = addressKey(record);
      let live = liveCounts.get(key);
      if (live === undefined)
        live = (yield* currentDocumentId(executor, record)) === undefined ? 0 : 1;
      if (action.retire && existing !== undefined) live--;
      if (action.create !== undefined && !action.retire) live++;
      liveCounts.set(key, live);
    }
    for (const live of liveCounts.values()) {
      if (live > 1) throw new Error("Document address already has a current incarnation");
    }
  }),
);

const documents = {
  checkDocumentActions,
  materializeDocument,
  prepareDocumentActions,
};

export default documents;
