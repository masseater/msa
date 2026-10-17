import { Cause, Effect, Function } from "effect";

import type {
  DocumentContent,
  DocumentId,
  DocumentRecord,
  Id,
  Seq,
  StorageWrite,
} from "../../types.ts";
import {
  addressParts,
  type DocumentAction,
  encodeIndexedString,
  encodeJson,
  isCurrentOnly,
  type RecordIdRow,
  type TableName,
} from "./codec.ts";
import type { SqliteExecutor, SqliteValue } from "./database.ts";
import { materializeDocument } from "./documents.ts";
import { recordById } from "./scans.ts";

const run = (executor: SqliteExecutor, sql: string, ...params: SqliteValue[]) =>
  Effect.promise(() => executor.run(sql, ...params));

const claimId = (executor: SqliteExecutor, id: Id<string>, table: TableName) =>
  run(executor, "INSERT OR IGNORE INTO record_ids (id, record_type) VALUES (?, ?)", id, table);

const checkClaim = (
  id: Id<string>,
  table: TableName,
  existing: TableName | undefined,
  earlier: TableName | undefined,
): void => {
  if (table === "conversation" || table === "entry" || table === "document") {
    if (existing !== undefined) throw new Error(`ID ${id} already belongs to ${existing}`);
    if (earlier !== undefined) throw new Error(`ID ${id} is written more than once`);
    return;
  }
  if (existing !== undefined && existing !== table)
    throw new Error(`ID ${id} already belongs to ${existing}`);
  if (earlier !== undefined && earlier !== table)
    throw new Error(`ID ${id} is written as two record types`);
};

export const checkGlobalIds: {
  (writes: readonly StorageWrite[]): (executor: SqliteExecutor) => Effect.Effect<void>;
  (executor: SqliteExecutor, writes: readonly StorageWrite[]): Effect.Effect<void>;
} = Function.dual(
  2,
  Effect.fn("checkGlobalIds")(function* (
    executor: SqliteExecutor,
    writes: readonly StorageWrite[],
  ) {
    const claimed = new Map<Id<string>, TableName>();
    for (const write of writes) {
      if (write.type === "document.change" || write.type === "document.retire") continue;
      const document = write.type === "document.create" || write.type === "document.copy";
      const table: TableName = document ? "document" : write.type;
      const id = document ? write.record.id : write.value.id;
      const row = yield* Effect.promise(() =>
        executor.get<RecordIdRow>("SELECT record_type FROM record_ids WHERE id = ?", id),
      );
      checkClaim(id, table, row?.record_type, claimed.get(id));
      claimed.set(id, table);
    }
  }),
);

const TASK_UPSERT = `INSERT INTO tasks (id, conversation_id, kind, status, abort_requested, background, record)
						VALUES (?, ?, ?, ?, ?, ?, ?)
						ON CONFLICT(id) DO UPDATE SET conversation_id = excluded.conversation_id, kind = excluded.kind,
						status = excluded.status, abort_requested = excluded.abort_requested,
						background = excluded.background, record = excluded.record`;

const SUBMISSION_UPSERT = `INSERT INTO submissions (id, conversation_id, request_id, status, record) VALUES (?, ?, ?, ?, ?)
						ON CONFLICT(id) DO UPDATE SET conversation_id = excluded.conversation_id,
						request_id = excluded.request_id, status = excluded.status, record = excluded.record`;

const tableInsert = (executor: SqliteExecutor, write: StorageWrite, seq: Seq) => {
  switch (write.type) {
    case "conversation":
      return run(
        executor,
        "INSERT INTO conversations (id, owner_conversation_id, owner_task_id, record) VALUES (?, ?, ?, ?)",
        write.value.id,
        write.value.owner?.conversationId ?? null,
        write.value.owner?.taskId ?? null,
        encodeJson(write.value),
      );
    case "entry":
      return run(
        executor,
        "INSERT INTO entries (id, conversation_id, head, commit_seq, record) VALUES (?, ?, ?, ?, ?)",
        write.value.id,
        write.value.conversationId,
        write.value.head ?? null,
        seq,
        encodeJson(write.value),
      );
    case "task":
      return run(
        executor,
        TASK_UPSERT,
        write.value.id,
        write.value.conversationId,
        encodeIndexedString(write.value.kind),
        write.value.state.status,
        write.value.abortRequested ? 1 : 0,
        write.value.background ? 1 : 0,
        encodeJson(write.value),
      );
    case "submission":
      return run(
        executor,
        SUBMISSION_UPSERT,
        write.value.id,
        write.value.conversationId,
        write.value.requestId === undefined ? null : encodeIndexedString(write.value.requestId),
        write.value.status,
        encodeJson(write.value),
      );
    case "document.create":
    case "document.copy":
    case "document.change":
    case "document.retire":
      return Effect.void;
  }
};

export const applyTableWrite: {
  (write: StorageWrite, seq: Seq): (executor: SqliteExecutor) => Effect.Effect<void>;
  (executor: SqliteExecutor, write: StorageWrite, seq: Seq): Effect.Effect<void>;
} = Function.dual(3, (executor: SqliteExecutor, write: StorageWrite, seq: Seq) => {
  switch (write.type) {
    case "conversation":
    case "entry":
    case "task":
    case "submission":
      return Effect.andThen(
        claimId(executor, write.value.id, write.type),
        tableInsert(executor, write, seq),
      );
    case "document.create":
    case "document.copy":
    case "document.change":
    case "document.retire":
      return Effect.void;
  }
});

const copiedContent = Effect.fn("copiedContent")(function* (
  executor: SqliteExecutor,
  id: DocumentId,
  action: DocumentAction,
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
    const content: DocumentContent = {
      kind: "base",
      version: stored.version,
      value: stored.value,
    };
    return content;
  }).pipe(
    Effect.catchCause((cause) =>
      Effect.die(new Error(`Document copy ${id} was rejected`, { cause: Cause.squash(cause) })),
    ),
  );
});

const insertDocument = Effect.fn("insertDocument")(function* (
  executor: SqliteExecutor,
  id: DocumentId,
  action: DocumentAction & { readonly create: NonNullable<DocumentAction["create"]> },
  seq: Seq,
) {
  const record: DocumentRecord = {
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

const writeRevision = Effect.fn("writeRevision")(function* (
  executor: SqliteExecutor,
  id: DocumentId,
  record: DocumentRecord,
  content: DocumentContent,
  seq: Seq,
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

const retireDocument = Effect.fn("retireDocument")(function* (
  executor: SqliteExecutor,
  id: DocumentId,
  action: DocumentAction,
  stored: DocumentRecord,
  seq: Seq,
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

const applyDocumentAction = Effect.fn("applyDocumentAction")(function* (
  executor: SqliteExecutor,
  id: DocumentId,
  action: DocumentAction,
  seq: Seq,
) {
  const content = yield* copiedContent(executor, id, action);
  const create = action.create;
  const record =
    create === undefined
      ? (yield* recordById<DocumentRecord>(executor, "documents", id))!
      : yield* insertDocument(executor, id, { ...action, create }, seq);
  if (content !== undefined) yield* writeRevision(executor, id, record, content, seq);
  if (action.retire) yield* retireDocument(executor, id, action, record, seq);
});

export const applyDocumentActions: {
  (
    actions: ReadonlyMap<DocumentId, DocumentAction>,
    seq: Seq,
  ): (executor: SqliteExecutor) => Effect.Effect<void>;
  (
    executor: SqliteExecutor,
    actions: ReadonlyMap<DocumentId, DocumentAction>,
    seq: Seq,
  ): Effect.Effect<void>;
} = Function.dual(
  3,
  (executor: SqliteExecutor, actions: ReadonlyMap<DocumentId, DocumentAction>, seq: Seq) =>
    Effect.forEach(actions, ([id, action]) => applyDocumentAction(executor, id, action, seq), {
      discard: true,
    }),
);
