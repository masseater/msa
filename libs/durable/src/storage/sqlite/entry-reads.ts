import { Effect, Function } from "effect";

import errors from "../../errors.ts";
import type typesModule from "../../types.types.ts";
import scan from "../scan.ts";
import codec from "./codec.ts";
import type codecTypes from "./codec.types.ts";
import type databaseTypes from "./database.ts";

const { page, parseJson } = codec;

const { StorageRequestError } = errors;

const { scanStart } = scan;

const readConversation: {
  (
    id: typesModule.ConversationId,
  ): (
    db: databaseTypes.SqliteExecutor,
  ) => Effect.Effect<typesModule.ConversationRecord | undefined>;
  (
    db: databaseTypes.SqliteExecutor,
    id: typesModule.ConversationId,
  ): Effect.Effect<typesModule.ConversationRecord | undefined>;
} = Function.dual(2, (db: databaseTypes.SqliteExecutor, id: typesModule.ConversationId) =>
  Effect.map(
    Effect.promise(() =>
      db.get<codecTypes.JsonRow>("SELECT record FROM conversations WHERE id = ?", id),
    ),
    (row) =>
      row === undefined ? undefined : parseJson<typesModule.ConversationRecord>(row.record),
  ),
);

const knownConversation = Effect.fnUntraced(function* (
  db: databaseTypes.SqliteExecutor,
  id: typesModule.ConversationId,
) {
  const conversation = yield* readConversation(db, id);
  if (conversation === undefined) throw new StorageRequestError(`Unknown conversation: ${id}`);
  return conversation;
});

const parentOf = (db: databaseTypes.SqliteExecutor, conversation: typesModule.ConversationRecord) =>
  Effect.map(readConversation(db, conversation.parent!.conversationId), (parent) => parent!);

const nextUpperOf = (upper: number | undefined, parentAt: number): number =>
  upper === undefined ? parentAt : Math.min(upper, parentAt);

const selectEntries = (
  db: databaseTypes.SqliteExecutor,
  conversationId: typesModule.ConversationId,
  lower: number | undefined,
  upper: number | undefined,
  direction: "ASC" | "DESC",
  limit: number,
) => {
  const clauses = ["conversation_id = ?"];
  const params: databaseTypes.SqliteValue[] = [conversationId];
  if (lower !== undefined) {
    clauses.push("id >= ?");
    params.push(lower);
  }
  if (upper !== undefined) {
    clauses.push("id <= ?");
    params.push(upper);
  }
  params.push(limit);
  return Effect.map(
    Effect.promise(() =>
      db.all<codecTypes.JsonRow>(
        `SELECT record FROM entries WHERE ${clauses.join(" AND ")} ORDER BY id ${direction} LIMIT ?`,
        ...params,
      ),
    ),
    (rows) => rows.map((row) => parseJson<typesModule.EntryRecord>(row.record)),
  );
};

const readDescending = Effect.fnUntraced(function* (
  db: databaseTypes.SqliteExecutor,
  query: typesModule.EntryQuery,
  limit: number,
  after: number | undefined,
) {
  let conversation = yield* knownConversation(db, query.conversationId);
  let upper: number | undefined = query.maxEntryId;
  if (after !== undefined) upper = Math.min(upper ?? Number.MAX_SAFE_INTEGER, after - 1);
  const values: typesModule.EntryRecord[] = [];
  while (true) {
    const rows = yield* selectEntries(
      db,
      conversation.id,
      query.minEntryId,
      upper,
      "DESC",
      limit + 1 - values.length,
    );
    values.push(...rows);
    if (values.length > limit || conversation.parent === undefined) break;
    upper = nextUpperOf(upper, conversation.parent.at);
    if (query.minEntryId !== undefined && upper < query.minEntryId) break;
    conversation = yield* parentOf(db, conversation);
  }
  return page(values, limit, "descending");
});

const forkSegments = Effect.fnUntraced(function* (
  db: databaseTypes.SqliteExecutor,
  query: typesModule.EntryQuery,
) {
  let conversation = yield* knownConversation(db, query.conversationId);
  let upper: number | undefined = query.maxEntryId;
  const segments: codecTypes.ForkSegment[] = [];
  while (true) {
    segments.push({ conversationId: conversation.id, upper });
    if (conversation.parent === undefined) break;
    upper = nextUpperOf(upper, conversation.parent.at);
    if (query.minEntryId !== undefined && upper < query.minEntryId) break;
    conversation = yield* parentOf(db, conversation);
  }
  return segments;
});

const readAscending = Effect.fnUntraced(function* (
  db: databaseTypes.SqliteExecutor,
  query: typesModule.EntryQuery,
  limit: number,
  after: number | undefined,
) {
  const segments = yield* forkSegments(db, query);
  let lower: number | undefined = query.minEntryId;
  if (after !== undefined) lower = Math.max(lower ?? after + 1, after + 1);
  const values: typesModule.EntryRecord[] = [];
  for (const segment of segments.reverse()) {
    const rows = yield* selectEntries(
      db,
      segment.conversationId,
      lower,
      segment.upper,
      "ASC",
      limit + 1 - values.length,
    );
    values.push(...rows);
    if (values.length > limit) break;
  }
  return page(values, limit, "ascending");
});

const readEntries: {
  (
    query: typesModule.EntryQuery,
    limit: number,
    cursor: typesModule.Cursor | undefined,
  ): (
    db: databaseTypes.SqliteExecutor,
  ) => Effect.Effect<typesModule.Page<typesModule.EntryRecord, typesModule.Cursor>>;
  (
    db: databaseTypes.SqliteExecutor,
    query: typesModule.EntryQuery,
    limit: number,
    cursor: typesModule.Cursor | undefined,
  ): Effect.Effect<typesModule.Page<typesModule.EntryRecord, typesModule.Cursor>>;
} = Function.dual(
  4,
  (
    db: databaseTypes.SqliteExecutor,
    query: typesModule.EntryQuery,
    limit: number,
    cursor: typesModule.Cursor | undefined,
  ) =>
    Effect.suspend(() => {
      const { order, after } = scanStart(query.order, cursor, "descending");
      return order === "ascending"
        ? readAscending(db, query, limit, after)
        : readDescending(db, query, limit, after);
    }),
);

const entryReads = { knownConversation, nextUpperOf, parentOf, readConversation, readEntries };

export default entryReads;
