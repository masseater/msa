import { Function } from "effect";

import type {
  ConversationId,
  ConversationQuery,
  ConversationRecord,
  Cursor,
  DocumentAddress,
  DocumentPoint,
  DocumentQuery,
  DocumentRecord,
  Id,
  Page,
  SubmissionQuery,
  SubmissionRecord,
  TaskQuery,
} from "../../types.ts";
import { scanStart } from "../scan.ts";
import {
  addressParts,
  cursorId,
  encodeIndexedString,
  type JsonRow,
  page,
  parseJson,
  scanSql,
  scopeColumns,
  type StoredTask,
} from "./codec.ts";
import type { SqliteExecutor, SqliteValue } from "./database.ts";

type Filter = readonly [clause: string, param: SqliteValue] | undefined;

const scanTable = <T extends { readonly id: Id<string> }>(
  db: SqliteExecutor,
  table: string,
  order: ConversationQuery["order"],
  cursor: Cursor | undefined,
  limit: number,
  filters: readonly Filter[],
): Promise<Page<T, Cursor>> => {
  const start = scanStart(order, cursor, "ascending");
  const scan = scanSql(start);
  const clauses = [scan.clause];
  const params: SqliteValue[] = [scan.param];
  for (const filter of filters) {
    if (filter === undefined) continue;
    clauses.push(filter[0]);
    params.push(filter[1]);
  }
  params.push(limit + 1);
  return db
    .all<JsonRow>(
      `SELECT record FROM ${table} WHERE ${clauses.join(" AND ")} ORDER BY id ${scan.direction} LIMIT ?`,
      ...params,
    )
    .then((rows) =>
      page(
        rows.map((row) => parseJson<T>(row.record)),
        limit,
        start.order,
      ),
    );
};

const filter = <V>(clause: string, value: V | undefined, encode: (value: V) => SqliteValue) =>
  value === undefined ? undefined : ([clause, encode(value)] as const);

const asValue = (value: number | string): SqliteValue => value;
const asFlag = (value: boolean): SqliteValue => (value ? 1 : 0);

type Scan<Q, T> = {
  (
    query: Q,
    limit: number,
    cursor: Cursor | undefined,
  ): (db: SqliteExecutor) => Promise<Page<T, Cursor>>;
  (
    db: SqliteExecutor,
    query: Q,
    limit: number,
    cursor: Cursor | undefined,
  ): Promise<Page<T, Cursor>>;
};

export const scanConversationRows: Scan<ConversationQuery, ConversationRecord> = Function.dual(
  4,
  (db: SqliteExecutor, query: ConversationQuery, limit: number, cursor: Cursor | undefined) =>
    scanTable<ConversationRecord>(db, "conversations", query.order, cursor, limit, [
      filter("owner_conversation_id = ?", query.ownerConversationId, asValue),
      filter("owner_task_id = ?", query.ownerTaskId, asValue),
    ]),
);

export const scanTaskRows: Scan<TaskQuery, StoredTask> = Function.dual(
  4,
  (db: SqliteExecutor, query: TaskQuery, limit: number, cursor: Cursor | undefined) =>
    scanTable<StoredTask>(db, "tasks", query.order, cursor, limit, [
      filter("conversation_id = ?", query.conversationId, asValue),
      filter("kind = ?", query.kind, encodeIndexedString),
      filter("status = ?", query.status, asValue),
      filter("abort_requested = ?", query.abortRequested, asFlag),
      filter("background = ?", query.background, asFlag),
    ]),
);

export const scanSubmissionRows: Scan<SubmissionQuery, SubmissionRecord> = Function.dual(
  4,
  (db: SqliteExecutor, query: SubmissionQuery, limit: number, cursor: Cursor | undefined) =>
    scanTable<SubmissionRecord>(db, "submissions", query.order, cursor, limit, [
      filter("conversation_id = ?", query.conversationId, asValue),
      filter("status = ?", query.status, asValue),
    ]),
);

export const scanDocumentRows: Scan<DocumentQuery, DocumentRecord> = Function.dual(
  4,
  (db: SqliteExecutor, query: DocumentQuery, limit: number, cursor: Cursor | undefined) => {
    const scope = scopeColumns(query.scope);
    const clauses = ["scope_kind = ?", "owner_id = ?", "id > ?"];
    const params: SqliteValue[] = [scope.scopeKind, scope.ownerId, cursorId(cursor) ?? -1];
    if (query.kind !== undefined) {
      clauses.push("kind = ?");
      params.push(encodeIndexedString(query.kind));
    }
    if (query.at === "current") {
      clauses.push("retired_at IS NULL");
    } else {
      clauses.push("created_at <= ?", "(retired_at IS NULL OR retired_at > ?)");
      params.push(query.at, query.at);
    }
    params.push(limit + 1);
    return db
      .all<JsonRow>(
        `SELECT record FROM documents WHERE ${clauses.join(" AND ")} ORDER BY id LIMIT ?`,
        ...params,
      )
      .then((rows) =>
        page(
          rows.map((row) => parseJson<DocumentRecord>(row.record)),
          limit,
        ),
      );
  },
);

const CURRENT_DOCUMENT = `SELECT record FROM documents
					WHERE kind = ? AND scope_kind = ? AND owner_id = ? AND family = ? AND key_value = ?
					AND retired_at IS NULL ORDER BY created_at DESC LIMIT 1`;

const HISTORICAL_DOCUMENT = `SELECT record FROM documents
					WHERE kind = ? AND scope_kind = ? AND owner_id = ? AND family = ? AND key_value = ?
					AND created_at <= ? AND (retired_at IS NULL OR retired_at > ?)
					ORDER BY created_at DESC LIMIT 1`;

export const findDocumentRow: {
  (
    address: DocumentAddress,
    at: DocumentPoint,
  ): (db: SqliteExecutor) => Promise<DocumentRecord | undefined>;
  (
    db: SqliteExecutor,
    address: DocumentAddress,
    at: DocumentPoint,
  ): Promise<DocumentRecord | undefined>;
} = Function.dual(3, (db: SqliteExecutor, address: DocumentAddress, at: DocumentPoint) => {
  const parts = addressParts(address);
  const params: SqliteValue[] = [
    parts.kind,
    parts.scopeKind,
    parts.ownerId,
    parts.family,
    parts.keyValue,
  ];
  if (at !== "current") params.push(at, at);
  return db
    .get<JsonRow>(at === "current" ? CURRENT_DOCUMENT : HISTORICAL_DOCUMENT, ...params)
    .then((row) => (row === undefined ? undefined : parseJson<DocumentRecord>(row.record)));
});

export const recordById: {
  <T>(table: string, id: SqliteValue): (db: SqliteExecutor) => Promise<T | undefined>;
  <T>(db: SqliteExecutor, table: string, id: SqliteValue): Promise<T | undefined>;
} = Function.dual(3, <T>(db: SqliteExecutor, table: string, id: SqliteValue) =>
  db
    .get<JsonRow>(`SELECT record FROM ${table} WHERE id = ?`, id)
    .then((row) => (row === undefined ? undefined : parseJson<T>(row.record))),
);

export const submissionByRequestRow: {
  (
    conversationId: ConversationId,
    requestId: string,
  ): (executor: SqliteExecutor) => Promise<SubmissionRecord | undefined>;
  (
    executor: SqliteExecutor,
    conversationId: ConversationId,
    requestId: string,
  ): Promise<SubmissionRecord | undefined>;
} = Function.dual(
  3,
  (executor: SqliteExecutor, conversationId: ConversationId, requestId: string) =>
    executor
      .get<JsonRow>(
        "SELECT record FROM submissions WHERE conversation_id = ? AND request_id = ?",
        conversationId,
        encodeIndexedString(requestId),
      )
      .then((row) => (row === undefined ? undefined : parseJson<SubmissionRecord>(row.record))),
);
