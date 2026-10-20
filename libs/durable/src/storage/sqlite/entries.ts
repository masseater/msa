import type chordTypes from "@msa/chord/index.types";
import { Effect, Function } from "effect";

import errors from "../../errors.ts";
import ids from "../../ids.ts";
import type typesModule from "../../types.types.ts";
import codec from "./codec.ts";
import type codecTypes from "./codec.types.ts";
import type databaseTypes from "./database.ts";
import entryReads from "./entry-reads.ts";

const { knownConversation, nextUpperOf, parentOf, readConversation, readEntries } = entryReads;

const { parseJson } = codec;
const { StorageRequestError } = errors;
const { idFromNumber, seqFromNumber } = ids;
type EntryRead = { readonly entry: typesModule.EntryRecord; readonly commitSeq: typesModule.Seq };
type HeadMarker = typesModule.EntryRecord & { readonly head: typesModule.EntryId };
const visibleFrom = Effect.fnUntraced(function* (
  db: databaseTypes.SqliteExecutor,
  start: typesModule.ConversationRecord,
  entry: typesModule.EntryRecord,
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
  idOrConversationId: typesModule.EntryId | typesModule.ConversationId,
  idOrContext: typesModule.EntryId | chordTypes.Context,
  context: chordTypes.Context | undefined,
): typesModule.EntryId => {
  if (context === undefined) return idFromNumber<typesModule.EntryId>(idOrConversationId);
  if (typeof idOrContext === "number") return idFromNumber<typesModule.EntryId>(idOrContext);
  throw new StorageRequestError("Storage.entry() requires an entry ID");
};

const readEntry: {
  (
    idOrConversationId: typesModule.EntryId | typesModule.ConversationId,
    idOrContext: typesModule.EntryId | chordTypes.Context,
    context: chordTypes.Context | undefined,
  ): (db: databaseTypes.SqliteExecutor) => Effect.Effect<EntryRead | undefined>;
  (
    db: databaseTypes.SqliteExecutor,
    idOrConversationId: typesModule.EntryId | typesModule.ConversationId,
    idOrContext: typesModule.EntryId | chordTypes.Context,
    context: chordTypes.Context | undefined,
  ): Effect.Effect<EntryRead | undefined>;
} = Function.dual(
  4,
  Effect.fnUntraced(function* (
    db: databaseTypes.SqliteExecutor,
    idOrConversationId: typesModule.EntryId | typesModule.ConversationId,
    idOrContext: typesModule.EntryId | chordTypes.Context,
    context: chordTypes.Context | undefined,
  ) {
    const id = entryIdOf(idOrConversationId, idOrContext, context);
    const conversation =
      context === undefined
        ? undefined
        : yield* knownConversation(
            db,
            idFromNumber<typesModule.ConversationId>(idOrConversationId),
          );
    const row = yield* Effect.promise(() =>
      db.get<codecTypes.EntryJsonRow>("SELECT record, commit_seq FROM entries WHERE id = ?", id),
    );
    if (row === undefined) return undefined;
    const entry = parseJson<typesModule.EntryRecord>(row.record);
    if (conversation !== undefined && !(yield* visibleFrom(db, conversation, entry)))
      return undefined;
    return { commitSeq: seqFromNumber(row.commit_seq), entry };
  }),
);

const headRow = (
  db: databaseTypes.SqliteExecutor,
  conversationId: typesModule.ConversationId,
  upper: number | undefined,
) =>
  Effect.promise(() =>
    upper === undefined
      ? db.get<codecTypes.JsonRow>(
          "SELECT record FROM entries WHERE conversation_id = ? AND head IS NOT NULL ORDER BY id DESC LIMIT 1",
          conversationId,
        )
      : db.get<codecTypes.JsonRow>(
          "SELECT record FROM entries WHERE conversation_id = ? AND head IS NOT NULL AND id <= ? ORDER BY id DESC LIMIT 1",
          conversationId,
          upper,
        ),
  );
const readLatestHeadMarker: {
  (
    conversationId: typesModule.ConversationId,
    atOrBeforeEntryId: typesModule.EntryId | undefined,
  ): (db: databaseTypes.SqliteExecutor) => Effect.Effect<HeadMarker | undefined>;
  (
    db: databaseTypes.SqliteExecutor,
    conversationId: typesModule.ConversationId,
    atOrBeforeEntryId: typesModule.EntryId | undefined,
  ): Effect.Effect<HeadMarker | undefined>;
} = Function.dual(
  3,
  Effect.fnUntraced(function* (
    db: databaseTypes.SqliteExecutor,
    conversationId: typesModule.ConversationId,
    atOrBeforeEntryId: typesModule.EntryId | undefined,
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
const entries = {
  readConversation,
  readEntries,
  readEntry,
  readLatestHeadMarker,
};

export default entries;
