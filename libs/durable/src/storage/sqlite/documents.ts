import { apply, type Op } from "@msa/chord/delta";
import { Effect, Function } from "effect";

import { StorageRequestError } from "../../errors.ts";
import { idFromNumber } from "../../ids.ts";
import type {
  DocumentAddress,
  DocumentCreate,
  DocumentId,
  DocumentPoint,
  DocumentRecord,
  JsonObject,
  StorageWrite,
  StoredDocument,
} from "../../types.ts";
import {
  addressKey,
  addressParts,
  type DocumentAction,
  type IdRow,
  isAliveAt,
  isCurrentOnly,
  parseJson,
  type RevisionRow,
} from "./codec.ts";
import type { SqliteExecutor } from "./database.ts";
import { recordById } from "./scans.ts";

const readRevisions = Effect.fn("readRevisions")(function* (
  executor: SqliteExecutor,
  id: DocumentId,
  upper: number,
) {
  const base = yield* Effect.promise(() =>
    executor.get<RevisionRow>(
      `SELECT seq, kind, version, content FROM document_revisions
				WHERE document_id = ? AND kind = 'base' AND seq <= ? ORDER BY seq DESC LIMIT 1`,
      id,
      upper,
    ),
  );
  if (base === undefined) throw new Error(`Document ${id} is missing a required base`);
  const tail = yield* Effect.promise(() =>
    executor.all<RevisionRow>(
      `SELECT seq, kind, version, content FROM document_revisions
				WHERE document_id = ? AND seq > ? AND seq <= ? ORDER BY seq`,
      id,
      base.seq,
      upper,
    ),
  );
  return { base, tail };
});

export const materializeDocument: {
  (
    id: DocumentId,
    at: DocumentPoint,
  ): (executor: SqliteExecutor) => Effect.Effect<StoredDocument | undefined>;
  (
    executor: SqliteExecutor,
    id: DocumentId,
    at: DocumentPoint,
  ): Effect.Effect<StoredDocument | undefined>;
} = Function.dual(
  3,
  Effect.fn("materializeDocument")(function* (
    executor: SqliteExecutor,
    id: DocumentId,
    at: DocumentPoint,
  ) {
    const record = yield* recordById<DocumentRecord>(executor, "documents", id);
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
    let value = parseJson<JsonObject>(base.content);
    for (const revision of tail) {
      if (revision.kind !== "delta" || revision.version !== base.version) {
        throw new Error(`Document ${id} crosses a stored version boundary without a base`);
      }
      value = apply(value, parseJson<readonly Op[]>(revision.content)) as JsonObject;
    }
    return { record, version: base.version, value, deltasSinceBase: tail.length };
  }),
);

type DocumentWrite = Extract<
  StorageWrite,
  { type: "document.create" | "document.copy" | "document.change" | "document.retire" }
>;

const isDocumentWrite = (write: StorageWrite): write is DocumentWrite =>
  write.type === "document.create" ||
  write.type === "document.copy" ||
  write.type === "document.change" ||
  write.type === "document.retire";

const assertOneContent = (action: DocumentAction, id: DocumentId, create: boolean): void => {
  if (
    (create && action.create !== undefined) ||
    action.content !== undefined ||
    action.copy !== undefined
  ) {
    throw new Error(`Document ${id} has more than one content command`);
  }
};

const addDocumentWrite = (action: DocumentAction, write: DocumentWrite, id: DocumentId): void => {
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

export const prepareDocumentActions = (
  writes: readonly StorageWrite[],
): Map<DocumentId, DocumentAction> => {
  const actions = new Map<DocumentId, DocumentAction>();
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

const currentDocumentId = Effect.fn("currentDocumentId")(function* (
  executor: SqliteExecutor,
  address: DocumentAddress | DocumentCreate | DocumentRecord,
) {
  const parts = addressParts(address);
  const row = yield* Effect.promise(() =>
    executor.get<IdRow>(
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
  return row?.id === undefined ? undefined : idFromNumber<DocumentId>(row.id);
});

const checkDelta = Effect.fn("checkDelta")(function* (
  executor: SqliteExecutor,
  id: DocumentId,
  action: DocumentAction,
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

const checkDocumentAction = Effect.fn("checkDocumentAction")(function* (
  executor: SqliteExecutor,
  actions: ReadonlyMap<DocumentId, DocumentAction>,
  id: DocumentId,
  action: DocumentAction,
) {
  if (action.copy !== undefined && actions.has(action.copy.id)) {
    throw new Error(`Document copy ${id} source is changed in the copy batch`);
  }
  const existing = yield* recordById<DocumentRecord>(executor, "documents", id);
  if (action.create === undefined && existing === undefined)
    throw new Error(`Unknown document: ${id}`);
  if (action.create !== undefined && existing !== undefined)
    throw new Error(`Document ${id} already exists`);
  if (existing?.retiredAt !== undefined) throw new Error(`Document ${id} is retired`);
  yield* checkDelta(executor, id, action);
  return { record: action.create ?? existing!, existing };
});

export const checkDocumentActions: {
  (
    actions: ReadonlyMap<DocumentId, DocumentAction>,
  ): (executor: SqliteExecutor) => Effect.Effect<void>;
  (executor: SqliteExecutor, actions: ReadonlyMap<DocumentId, DocumentAction>): Effect.Effect<void>;
} = Function.dual(
  2,
  Effect.fn("checkDocumentActions")(function* (
    executor: SqliteExecutor,
    actions: ReadonlyMap<DocumentId, DocumentAction>,
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
