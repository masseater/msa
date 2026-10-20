import { Function } from "effect";

import type typesModule from "../../types.types.ts";
import codec from "./codec.ts";
import type codecTypes from "./codec.types.ts";
import type databaseTypes from "./database.ts";
import documentWrites from "./document-writes.ts";

const { CLAIM_ID, applyDocumentActions } = documentWrites;

const { encodeIndexedString, encodeJson } = codec;
const sequence: {
  <T>(step: (item: T) => Promise<void>): (items: Iterable<T>) => Promise<void>;
  <T>(items: Iterable<T>, step: (item: T) => Promise<void>): Promise<void>;
} = Function.dual(2, <T>(items: Iterable<T>, step: (item: T) => Promise<void>): Promise<void> => {
  let chain = Promise.resolve();
  for (const item of items) chain = chain.then(() => step(item));
  return chain;
});

const checkClaim = (
  id: typesModule.Id<string>,
  table: codecTypes.TableName,
  existing: codecTypes.TableName | undefined,
  earlier: codecTypes.TableName | undefined,
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

const checkGlobalIds: {
  (
    writes: readonly typesModule.StorageWrite[],
  ): (executor: databaseTypes.SqliteExecutor) => Promise<void>;
  (
    executor: databaseTypes.SqliteExecutor,
    writes: readonly typesModule.StorageWrite[],
  ): Promise<void>;
} = Function.dual(
  2,
  (executor: databaseTypes.SqliteExecutor, writes: readonly typesModule.StorageWrite[]) => {
    const claimed = new Map<typesModule.Id<string>, codecTypes.TableName>();
    return sequence(writes, (write) => {
      if (write.type === "document.change" || write.type === "document.retire") {
        return Promise.resolve();
      }
      const document = write.type === "document.create" || write.type === "document.copy";
      const table: codecTypes.TableName = document ? "document" : write.type;
      const id = document ? write.record.id : write.value.id;
      return executor
        .get<codecTypes.RecordIdRow>("SELECT record_type FROM record_ids WHERE id = ?", id)
        .then((row) => {
          checkClaim(id, table, row?.record_type, claimed.get(id));
          claimed.set(id, table);
          return undefined;
        });
    });
  },
);

const TASK_UPSERT = `INSERT INTO tasks (id, conversation_id, kind, status, abort_requested, background, record)
						VALUES (?, ?, ?, ?, ?, ?, ?)
						ON CONFLICT(id) DO UPDATE SET conversation_id = excluded.conversation_id, kind = excluded.kind,
						status = excluded.status, abort_requested = excluded.abort_requested,
						background = excluded.background, record = excluded.record`;

const SUBMISSION_UPSERT = `INSERT INTO submissions (id, conversation_id, request_id, status, record) VALUES (?, ?, ?, ?, ?)
						ON CONFLICT(id) DO UPDATE SET conversation_id = excluded.conversation_id,
						request_id = excluded.request_id, status = excluded.status, record = excluded.record`;

const tableInsert = (
  executor: databaseTypes.SqliteExecutor,
  write: typesModule.StorageWrite,
  seq: typesModule.Seq,
) => {
  switch (write.type) {
    case "conversation":
      return executor.run(
        "INSERT INTO conversations (id, owner_conversation_id, owner_task_id, record) VALUES (?, ?, ?, ?)",
        write.value.id,
        write.value.owner?.conversationId ?? null,
        write.value.owner?.taskId ?? null,
        encodeJson(write.value),
      );
    case "entry":
      return executor.run(
        "INSERT INTO entries (id, conversation_id, head, commit_seq, record) VALUES (?, ?, ?, ?, ?)",
        write.value.id,
        write.value.conversationId,
        write.value.head ?? null,
        seq,
        encodeJson(write.value),
      );
    case "task":
      return executor.run(
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
      return executor.run(
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
      return Promise.resolve();
  }
};

const applyTableWrite: {
  (
    write: typesModule.StorageWrite,
    seq: typesModule.Seq,
  ): (executor: databaseTypes.SqliteExecutor) => Promise<void>;
  (
    executor: databaseTypes.SqliteExecutor,
    write: typesModule.StorageWrite,
    seq: typesModule.Seq,
  ): Promise<void>;
} = Function.dual(
  3,
  (
    executor: databaseTypes.SqliteExecutor,
    write: typesModule.StorageWrite,
    seq: typesModule.Seq,
  ) => {
    switch (write.type) {
      case "conversation":
      case "entry":
      case "task":
      case "submission":
        return executor
          .run(CLAIM_ID, write.value.id, write.type)
          .then(() => tableInsert(executor, write, seq));
      case "document.create":
      case "document.copy":
      case "document.change":
      case "document.retire":
        return Promise.resolve();
    }
  },
);
const writesModule = {
  applyDocumentActions,
  applyTableWrite,
  checkGlobalIds,
  sequence,
};

export default writesModule;
