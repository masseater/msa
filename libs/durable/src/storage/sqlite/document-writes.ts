import { Cause, Effect, Function } from "effect";

import type typesModule from "../../types.types.ts";
import codec from "./codec.ts";
import type codecTypes from "./codec.types.ts";
import type databaseTypes from "./database.ts";
import documents from "./documents.ts";
import scans from "./scans.ts";

const { addressParts, encodeJson, isCurrentOnly } = codec;

const { materializeDocument } = documents;

const { recordById } = scans;

const run = (
  executor: databaseTypes.SqliteExecutor,
  sql: string,
  ...params: databaseTypes.SqliteValue[]
) => Effect.promise(() => executor.run(sql, ...params));

const CLAIM_ID = "INSERT OR IGNORE INTO record_ids (id, record_type) VALUES (?, ?)";

const claimId = (
  executor: databaseTypes.SqliteExecutor,
  id: typesModule.Id<string>,
  table: codecTypes.TableName,
) => run(executor, CLAIM_ID, id, table);

const copiedContent = Effect.fnUntraced(function* (
  executor: databaseTypes.SqliteExecutor,
  id: typesModule.DocumentId,
  action: codecTypes.DocumentAction,
) {
  const copy = action.copy;
  if (copy === undefined) return action.content;
  return yield* Effect.gen(function* () {
    const stored = yield* materializeDocument(executor, copy.id, copy.at);
    if (stored === undefined) throw new Error(`Fork source document ${copy.id} cannot be read`);
    const create = action.create!;
    if (
      stored.record.scope.kind !== "conversation" ||
      create.scope.kind !== "conversation" ||
      stored.record.kind !== create.kind ||
      stored.record.key !== create.key ||
      stored.record.history !== create.history ||
      stored.record.fork !== create.fork
    ) {
      throw new Error(`Fork source document ${copy.id} does not match the copied record`);
    }
    const content: typesModule.DocumentContent = {
      kind: "base",
      value: stored.value,
      version: stored.version,
    };
    return content;
  }).pipe(
    Effect.catchCause((cause) =>
      Effect.die(new Error(`Document copy ${id} was rejected`, { cause: Cause.squash(cause) })),
    ),
  );
});

const insertDocument = Effect.fnUntraced(function* (
  executor: databaseTypes.SqliteExecutor,
  id: typesModule.DocumentId,
  action: codecTypes.DocumentAction & {
    readonly create: NonNullable<codecTypes.DocumentAction["create"]>;
  },
  seq: typesModule.Seq,
) {
  const record: typesModule.DocumentRecord = {
    ...action.create,
    createdAt: seq,
    ...(action.retire ? { retiredAt: seq } : {}),
  };
  const parts = addressParts(record);
  yield* claimId(executor, id, "document");
  yield* run(
    executor,
    `INSERT INTO documents
						(id, kind, family, key_value, scope_kind, owner_id, created_at, retired_at, record)
						VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id,
    parts.kind,
    parts.family,
    parts.keyValue,
    parts.scopeKind,
    parts.ownerId,
    seq,
    action.retire ? seq : null,
    encodeJson(record),
  );
  return record;
});

const writeRevision = Effect.fnUntraced(function* (
  executor: databaseTypes.SqliteExecutor,
  id: typesModule.DocumentId,
  record: typesModule.DocumentRecord,
  content: typesModule.DocumentContent,
  seq: typesModule.Seq,
) {
  if (content.kind === "base" && isCurrentOnly(record)) {
    yield* run(executor, "DELETE FROM document_revisions WHERE document_id = ?", id);
  }
  yield* run(
    executor,
    "INSERT INTO document_revisions (document_id, seq, kind, version, content) VALUES (?, ?, ?, ?, ?)",
    id,
    seq,
    content.kind,
    content.version,
    content.kind === "base" ? encodeJson(content.value) : encodeJson(content.ops),
  );
});

const retireDocument = Effect.fnUntraced(function* (
  executor: databaseTypes.SqliteExecutor,
  id: typesModule.DocumentId,
  action: codecTypes.DocumentAction,
  stored: typesModule.DocumentRecord,
  seq: typesModule.Seq,
) {
  let record = stored;
  if (action.create === undefined) {
    record = { ...record, retiredAt: seq };
    yield* run(
      executor,
      "UPDATE documents SET retired_at = ?, record = ? WHERE id = ?",
      seq,
      encodeJson(record),
      id,
    );
  }
  if (isCurrentOnly(record)) {
    yield* run(executor, "DELETE FROM document_revisions WHERE document_id = ?", id);
  }
});

const applyDocumentAction = Effect.fnUntraced(function* (
  executor: databaseTypes.SqliteExecutor,
  id: typesModule.DocumentId,
  action: codecTypes.DocumentAction,
  seq: typesModule.Seq,
) {
  const content = yield* copiedContent(executor, id, action);
  const create = action.create;
  const record =
    create === undefined
      ? (yield* Effect.promise(() =>
          recordById<typesModule.DocumentRecord>(executor, "documents", id),
        ))!
      : yield* insertDocument(executor, id, { ...action, create }, seq);
  if (content !== undefined) yield* writeRevision(executor, id, record, content, seq);
  if (action.retire) yield* retireDocument(executor, id, action, record, seq);
});

const applyDocumentActions: {
  (
    actions: ReadonlyMap<typesModule.DocumentId, codecTypes.DocumentAction>,
    seq: typesModule.Seq,
  ): (executor: databaseTypes.SqliteExecutor) => Effect.Effect<void>;
  (
    executor: databaseTypes.SqliteExecutor,
    actions: ReadonlyMap<typesModule.DocumentId, codecTypes.DocumentAction>,
    seq: typesModule.Seq,
  ): Effect.Effect<void>;
} = Function.dual(
  3,
  (
    executor: databaseTypes.SqliteExecutor,
    actions: ReadonlyMap<typesModule.DocumentId, codecTypes.DocumentAction>,
    seq: typesModule.Seq,
  ) =>
    Effect.forEach(actions, ([id, action]) => applyDocumentAction(executor, id, action, seq), {
      discard: true,
    }),
);

const documentWrites = { CLAIM_ID, applyDocumentActions, run };

export default documentWrites;
