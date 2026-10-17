import type { Context } from "@msa/chord";
import { Effect, Function } from "effect";

import { StorageRequestError } from "../../errors.ts";
import { idFromNumber, seqFromNumber } from "../../ids.ts";
import type {
  ConversationId,
  ConversationRecord,
  Cursor,
  EntryId,
  EntryQuery,
  EntryRecord,
  Page,
  Seq,
} from "../../types.ts";
import { scanStart } from "../scan.ts";
import { type EntryJsonRow, type ForkSegment, type JsonRow, page, parseJson } from "./codec.ts";
import type { SqliteExecutor, SqliteValue } from "./database.ts";

type EntryRead = { readonly entry: EntryRecord; readonly commitSeq: Seq };
type HeadMarker = EntryRecord & { readonly head: EntryId };

export const readConversation: {
  (id: ConversationId): (db: SqliteExecutor) => Effect.Effect<ConversationRecord | undefined>;
  (db: SqliteExecutor, id: ConversationId): Effect.Effect<ConversationRecord | undefined>;
} = Function.dual(2, (db: SqliteExecutor, id: ConversationId) =>
  Effect.map(
    Effect.promise(() => db.get<JsonRow>("SELECT record FROM conversations WHERE id = ?", id)),
    (row) => (row === undefined ? undefined : parseJson<ConversationRecord>(row.record)),
  ),
);

const knownConversation = Effect.fnUntraced(function* (db: SqliteExecutor, id: ConversationId) {
  const conversation = yield* readConversation(db, id);
  if (conversation === undefined) throw new StorageRequestError(`Unknown conversation: ${id}`);
  return conversation;
});

const parentOf = (db: SqliteExecutor, conversation: ConversationRecord) =>
  Effect.map(readConversation(db, conversation.parent!.conversationId), (parent) => parent!);

const visibleFrom = Effect.fnUntraced(function* (
  db: SqliteExecutor,
  start: ConversationRecord,
  entry: EntryRecord,
) {
  let conversation = start;
  let upperEntryId = Number.POSITIVE_INFINITY;
  while (conversation.id !== entry.conversationId) {
    if (conversation.parent === undefined) return false;
    upperEntryId = Math.min(upperEntryId, conversation.parent.at);
    conversation = yield* parentOf(db, conversation);
  }
  return entry.id <= upperEntryId;
});

const entryIdOf = (
  idOrConversationId: EntryId | ConversationId,
  idOrContext: EntryId | Context,
  context: Context | undefined,
): EntryId => {
  if (context === undefined) return idFromNumber<EntryId>(idOrConversationId);
  if (typeof idOrContext === "number") return idFromNumber<EntryId>(idOrContext);
  throw new StorageRequestError("Storage.entry() requires an entry ID");
};

export const readEntry: {
  (
    idOrConversationId: EntryId | ConversationId,
    idOrContext: EntryId | Context,
    context: Context | undefined,
  ): (db: SqliteExecutor) => Effect.Effect<EntryRead | undefined>;
  (
    db: SqliteExecutor,
    idOrConversationId: EntryId | ConversationId,
    idOrContext: EntryId | Context,
    context: Context | undefined,
  ): Effect.Effect<EntryRead | undefined>;
} = Function.dual(
  4,
  Effect.fnUntraced(function* (
    db: SqliteExecutor,
    idOrConversationId: EntryId | ConversationId,
    idOrContext: EntryId | Context,
    context: Context | undefined,
  ) {
    const id = entryIdOf(idOrConversationId, idOrContext, context);
    const conversation =
      context === undefined
        ? undefined
        : yield* knownConversation(db, idFromNumber<ConversationId>(idOrConversationId));
    const row = yield* Effect.promise(() =>
      db.get<EntryJsonRow>("SELECT record, commit_seq FROM entries WHERE id = ?", id),
    );
    if (row === undefined) return undefined;
    const entry = parseJson<EntryRecord>(row.record);
    if (conversation !== undefined && !(yield* visibleFrom(db, conversation, entry)))
      return undefined;
    return { entry, commitSeq: seqFromNumber(row.commit_seq) };
  }),
);

const headRow = (db: SqliteExecutor, conversationId: ConversationId, upper: number | undefined) =>
  Effect.promise(() =>
    upper === undefined
      ? db.get<JsonRow>(
          "SELECT record FROM entries WHERE conversation_id = ? AND head IS NOT NULL ORDER BY id DESC LIMIT 1",
          conversationId,
        )
      : db.get<JsonRow>(
          "SELECT record FROM entries WHERE conversation_id = ? AND head IS NOT NULL AND id <= ? ORDER BY id DESC LIMIT 1",
          conversationId,
          upper,
        ),
  );

const nextUpperOf = (upper: number | undefined, parentAt: number): number =>
  upper === undefined ? parentAt : Math.min(upper, parentAt);

export const readLatestHeadMarker: {
  (
    conversationId: ConversationId,
    atOrBeforeEntryId: EntryId | undefined,
  ): (db: SqliteExecutor) => Effect.Effect<HeadMarker | undefined>;
  (
    db: SqliteExecutor,
    conversationId: ConversationId,
    atOrBeforeEntryId: EntryId | undefined,
  ): Effect.Effect<HeadMarker | undefined>;
} = Function.dual(
  3,
  Effect.fnUntraced(function* (
    db: SqliteExecutor,
    conversationId: ConversationId,
    atOrBeforeEntryId: EntryId | undefined,
  ) {
    let conversation = yield* knownConversation(db, conversationId);
    let upper: number | undefined = atOrBeforeEntryId;
    while (true) {
      const row = yield* headRow(db, conversation.id, upper);
      if (row !== undefined) return parseJson<HeadMarker>(row.record);
      if (conversation.parent === undefined) return undefined;
      upper = nextUpperOf(upper, conversation.parent.at);
      conversation = yield* parentOf(db, conversation);
    }
  }),
);

const selectEntries = (
  db: SqliteExecutor,
  conversationId: ConversationId,
  lower: number | undefined,
  upper: number | undefined,
  direction: "ASC" | "DESC",
  limit: number,
) => {
  const clauses = ["conversation_id = ?"];
  const params: SqliteValue[] = [conversationId];
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
      db.all<JsonRow>(
        `SELECT record FROM entries WHERE ${clauses.join(" AND ")} ORDER BY id ${direction} LIMIT ?`,
        ...params,
      ),
    ),
    (rows) => rows.map((row) => parseJson<EntryRecord>(row.record)),
  );
};

const readDescending = Effect.fnUntraced(function* (
  db: SqliteExecutor,
  query: EntryQuery,
  limit: number,
  after: number | undefined,
) {
  let conversation = yield* knownConversation(db, query.conversationId);
  let upper: number | undefined = query.maxEntryId;
  if (after !== undefined) upper = Math.min(upper ?? Number.MAX_SAFE_INTEGER, after - 1);
  const values: EntryRecord[] = [];
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

const forkSegments = Effect.fnUntraced(function* (db: SqliteExecutor, query: EntryQuery) {
  let conversation = yield* knownConversation(db, query.conversationId);
  let upper: number | undefined = query.maxEntryId;
  const segments: ForkSegment[] = [];
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
  db: SqliteExecutor,
  query: EntryQuery,
  limit: number,
  after: number | undefined,
) {
  const segments = yield* forkSegments(db, query);
  let lower: number | undefined = query.minEntryId;
  if (after !== undefined) lower = Math.max(lower ?? after + 1, after + 1);
  const values: EntryRecord[] = [];
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

export const readEntries: {
  (
    query: EntryQuery,
    limit: number,
    cursor: Cursor | undefined,
  ): (db: SqliteExecutor) => Effect.Effect<Page<EntryRecord, Cursor>>;
  (
    db: SqliteExecutor,
    query: EntryQuery,
    limit: number,
    cursor: Cursor | undefined,
  ): Effect.Effect<Page<EntryRecord, Cursor>>;
} = Function.dual(
  4,
  (db: SqliteExecutor, query: EntryQuery, limit: number, cursor: Cursor | undefined) =>
    Effect.suspend(() => {
      const { order, after } = scanStart(query.order, cursor, "descending");
      return order === "ascending"
        ? readAscending(db, query, limit, after)
        : readDescending(db, query, limit, after);
    }),
);
