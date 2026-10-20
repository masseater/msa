import { Function } from "effect";

import type typesModule from "../../types.types.ts";
import scanModule from "../scan.ts";
import codec from "./codec.ts";
import type codecTypes from "./codec.types.ts";
import type databaseTypes from "./database.ts";

const { scanStart } = scanModule;
const { addressParts, cursorId, encodeIndexedString, page, parseJson, scanSql, scopeColumns } =
  codec;

type Filter = readonly [clause: string, param: databaseTypes.SqliteValue] | undefined;

const scanTable = <T extends { readonly id: typesModule.Id<string> }>(
  db: databaseTypes.SqliteExecutor,
  table: string,
  order: typesModule.ConversationQuery["order"],
  cursor: typesModule.Cursor | undefined,
  limit: number,
  filters: readonly Filter[],
): Promise<typesModule.Page<T, typesModule.Cursor>> => {
  const start = scanStart(order, cursor, "ascending");
  const scan = scanSql(start);
  const clauses = [scan.clause];
  const params: databaseTypes.SqliteValue[] = [scan.param];
  for (const filter of filters) {
    if (filter === undefined) continue;
    clauses.push(filter[0]);
    params.push(filter[1]);
  }
  params.push(limit + 1);
  return db
    .all<codecTypes.JsonRow>(
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

const filter = <V>(
  clause: string,
  value: V | undefined,
  encode: (value: V) => databaseTypes.SqliteValue,
) => (value === undefined ? undefined : ([clause, encode(value)] as const));

const asValue = (value: number | string): databaseTypes.SqliteValue => value;
const asFlag = (value: boolean): databaseTypes.SqliteValue => (value ? 1 : 0);

type Scan<Q, T> = {
  (
    query: Q,
    limit: number,
    cursor: typesModule.Cursor | undefined,
  ): (db: databaseTypes.SqliteExecutor) => Promise<typesModule.Page<T, typesModule.Cursor>>;
  (
    db: databaseTypes.SqliteExecutor,
    query: Q,
    limit: number,
    cursor: typesModule.Cursor | undefined,
  ): Promise<typesModule.Page<T, typesModule.Cursor>>;
};

const scanConversationRows: Scan<typesModule.ConversationQuery, typesModule.ConversationRecord> =
  Function.dual(
    4,
    (
      db: databaseTypes.SqliteExecutor,
      query: typesModule.ConversationQuery,
      limit: number,
      cursor: typesModule.Cursor | undefined,
    ) =>
      scanTable<typesModule.ConversationRecord>(db, "conversations", query.order, cursor, limit, [
        filter("owner_conversation_id = ?", query.ownerConversationId, asValue),
        filter("owner_task_id = ?", query.ownerTaskId, asValue),
      ]),
  );

const scanTaskRows: Scan<typesModule.TaskQuery, codecTypes.StoredTask> = Function.dual(
  4,
  (
    db: databaseTypes.SqliteExecutor,
    query: typesModule.TaskQuery,
    limit: number,
    cursor: typesModule.Cursor | undefined,
  ) =>
    scanTable<codecTypes.StoredTask>(db, "tasks", query.order, cursor, limit, [
      filter("conversation_id = ?", query.conversationId, asValue),
      filter("kind = ?", query.kind, encodeIndexedString),
      filter("status = ?", query.status, asValue),
      filter("abort_requested = ?", query.abortRequested, asFlag),
      filter("background = ?", query.background, asFlag),
    ]),
);

const scanSubmissionRows: Scan<typesModule.SubmissionQuery, typesModule.SubmissionRecord> =
  Function.dual(
    4,
    (
      db: databaseTypes.SqliteExecutor,
      query: typesModule.SubmissionQuery,
      limit: number,
      cursor: typesModule.Cursor | undefined,
    ) =>
      scanTable<typesModule.SubmissionRecord>(db, "submissions", query.order, cursor, limit, [
        filter("conversation_id = ?", query.conversationId, asValue),
        filter("status = ?", query.status, asValue),
      ]),
  );

const scanDocumentRows: Scan<typesModule.DocumentQuery, typesModule.DocumentRecord> = Function.dual(
  4,
  (
    db: databaseTypes.SqliteExecutor,
    query: typesModule.DocumentQuery,
    limit: number,
    cursor: typesModule.Cursor | undefined,
  ) => {
    const scope = scopeColumns(query.scope);
    const clauses = ["scope_kind = ?", "owner_id = ?", "id > ?"];
    const params: databaseTypes.SqliteValue[] = [
      scope.scopeKind,
      scope.ownerId,
      cursorId(cursor) ?? -1,
    ];
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
      .all<codecTypes.JsonRow>(
        `SELECT record FROM documents WHERE ${clauses.join(" AND ")} ORDER BY id LIMIT ?`,
        ...params,
      )
      .then((rows) =>
        page(
          rows.map((row) => parseJson<typesModule.DocumentRecord>(row.record)),
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

const findDocumentRow: {
  (
    address: typesModule.DocumentAddress,
    at: typesModule.DocumentPoint,
  ): (db: databaseTypes.SqliteExecutor) => Promise<typesModule.DocumentRecord | undefined>;
  (
    db: databaseTypes.SqliteExecutor,
    address: typesModule.DocumentAddress,
    at: typesModule.DocumentPoint,
  ): Promise<typesModule.DocumentRecord | undefined>;
} = Function.dual(
  3,
  (
    db: databaseTypes.SqliteExecutor,
    address: typesModule.DocumentAddress,
    at: typesModule.DocumentPoint,
  ) => {
    const parts = addressParts(address);
    const params: databaseTypes.SqliteValue[] = [
      parts.kind,
      parts.scopeKind,
      parts.ownerId,
      parts.family,
      parts.keyValue,
    ];
    if (at !== "current") params.push(at, at);
    return db
      .get<codecTypes.JsonRow>(at === "current" ? CURRENT_DOCUMENT : HISTORICAL_DOCUMENT, ...params)
      .then((row) =>
        row === undefined ? undefined : parseJson<typesModule.DocumentRecord>(row.record),
      );
  },
);

const recordById: {
  <T>(
    table: string,
    id: databaseTypes.SqliteValue,
  ): (db: databaseTypes.SqliteExecutor) => Promise<T | undefined>;
  <T>(
    db: databaseTypes.SqliteExecutor,
    table: string,
    id: databaseTypes.SqliteValue,
  ): Promise<T | undefined>;
} = Function.dual(
  3,
  <T>(db: databaseTypes.SqliteExecutor, table: string, id: databaseTypes.SqliteValue) =>
    db
      .get<codecTypes.JsonRow>(`SELECT record FROM ${table} WHERE id = ?`, id)
      .then((row) => (row === undefined ? undefined : parseJson<T>(row.record))),
);

const submissionByRequestRow: {
  (
    conversationId: typesModule.ConversationId,
    requestId: string,
  ): (executor: databaseTypes.SqliteExecutor) => Promise<typesModule.SubmissionRecord | undefined>;
  (
    executor: databaseTypes.SqliteExecutor,
    conversationId: typesModule.ConversationId,
    requestId: string,
  ): Promise<typesModule.SubmissionRecord | undefined>;
} = Function.dual(
  3,
  (
    executor: databaseTypes.SqliteExecutor,
    conversationId: typesModule.ConversationId,
    requestId: string,
  ) =>
    executor
      .get<codecTypes.JsonRow>(
        "SELECT record FROM submissions WHERE conversation_id = ? AND request_id = ?",
        conversationId,
        encodeIndexedString(requestId),
      )
      .then((row) =>
        row === undefined ? undefined : parseJson<typesModule.SubmissionRecord>(row.record),
      ),
);

const scans = {
  findDocumentRow,
  recordById,
  scanConversationRows,
  scanDocumentRows,
  scanSubmissionRows,
  scanTaskRows,
  submissionByRequestRow,
};

export default scans;
