import type chordTypes from "@msa/chord/index.types";
import { Deferred, Effect } from "effect";

import ids from "../../ids.ts";
import type typesModule from "../../types.types.ts";
import commitModule from "./commit.ts";
import type databaseTypes from "./database.ts";
import documents from "./documents.ts";
import entries from "./entries.ts";
import migrationsModule from "./migrations.ts";
import scans from "./scans.ts";

const { applySqliteMigrations } = migrationsModule;
const { candidateNextId, commitIn, readMetadata } = commitModule;
const { materializeDocument, prepareDocumentActions } = documents;
const { idFromNumber } = ids;
const {
  findDocumentRow,
  recordById,
  scanConversationRows,
  scanDocumentRows,
  scanSubmissionRows,
  scanTaskRows,
  submissionByRequestRow,
} = scans;
const { readEntries, readEntry, readLatestHeadMarker } = entries;

type StoredTask = NonNullable<Awaited<ReturnType<typesModule.Storage["task"]>>>;
type EntryRead = { readonly entry: typesModule.EntryRecord; readonly commitSeq: typesModule.Seq };

export default class SqliteStorage implements typesModule.Storage {
  private readonly db: databaseTypes.SqliteDatabase;
  private nextId: number;
  private closed = false;
  private closing: Promise<void> | undefined;
  private admittedReads = 0;
  private readsDrained: Deferred.Deferred<void> | undefined;

  private constructor(db: databaseTypes.SqliteDatabase, nextId: number) {
    this.db = db;
    this.nextId = nextId;
  }

  static open(db: databaseTypes.SqliteDatabase): Promise<SqliteStorage> {
    return Effect.runPromise(
      Effect.gen(function* () {
        yield* Effect.promise(() => applySqliteMigrations(db));
        const metadata = yield* readMetadata(db);
        return new SqliteStorage(db, Number(metadata.next_id));
      }).pipe(Effect.onError(() => Effect.ignoreCause(Effect.promise(() => db.close())))),
    );
  }

  commit(
    writes: readonly typesModule.StorageWrite[],
    _context: chordTypes.Context,
  ): Promise<typesModule.Seq> {
    return this.query(() => {
      const documentActions = prepareDocumentActions(writes);
      const nextId = candidateNextId(this.nextId, writes);
      return this.db
        .transaction((transaction) => commitIn(transaction, writes, documentActions, nextId))
        .then((seq) => {
          this.nextId = Math.max(this.nextId, nextId);
          return seq;
        });
    });
  }

  mintId<I extends typesModule.Id<string>>(): Promise<I> {
    return this.query(() => {
      if (!Number.isSafeInteger(this.nextId)) throw new Error("ID space is exhausted");
      return Promise.resolve(idFromNumber<I>(this.nextId++));
    });
  }

  conversation(
    id: typesModule.ConversationId,
    _context: chordTypes.Context,
  ): Promise<typesModule.ConversationRecord | undefined> {
    return this.query(() =>
      recordById<typesModule.ConversationRecord>(this.db, "conversations", id),
    );
  }

  scanConversations(
    query: typesModule.ConversationQuery,
    limit: number,
    cursor: typesModule.Cursor | undefined,
    _context: chordTypes.Context,
  ): Promise<typesModule.Page<typesModule.ConversationRecord, typesModule.Cursor>> {
    return this.query(() => scanConversationRows(this.db, query, limit, cursor));
  }

  entry(id: typesModule.EntryId, context: chordTypes.Context): Promise<EntryRead | undefined>;
  entry(
    conversationId: typesModule.ConversationId,
    id: typesModule.EntryId,
    context: chordTypes.Context,
  ): Promise<EntryRead | undefined>;
  entry(
    idOrConversationId: typesModule.EntryId | typesModule.ConversationId,
    idOrContext: typesModule.EntryId | chordTypes.Context,
    context?: chordTypes.Context,
  ): Promise<EntryRead | undefined> {
    return this.admitRead(readEntry(this.db, idOrConversationId, idOrContext, context));
  }

  findLatestHeadMarker(
    conversationId: typesModule.ConversationId,
    atOrBeforeEntryId: typesModule.EntryId | undefined,
    _context: chordTypes.Context,
  ): Promise<(typesModule.EntryRecord & { readonly head: typesModule.EntryId }) | undefined> {
    return this.admitRead(readLatestHeadMarker(this.db, conversationId, atOrBeforeEntryId));
  }

  scanEntries(
    query: typesModule.EntryQuery,
    limit: number,
    cursor: typesModule.Cursor | undefined,
    _context: chordTypes.Context,
  ): Promise<typesModule.Page<typesModule.EntryRecord, typesModule.Cursor>> {
    return this.admitRead(readEntries(this.db, query, limit, cursor));
  }

  task(id: typesModule.TaskId, _context: chordTypes.Context): Promise<StoredTask | undefined> {
    return this.query(() => recordById<StoredTask>(this.db, "tasks", id));
  }

  scanTasks(
    query: typesModule.TaskQuery,
    limit: number,
    cursor: typesModule.Cursor | undefined,
    _context: chordTypes.Context,
  ): Promise<typesModule.Page<StoredTask, typesModule.Cursor>> {
    return this.query(() => scanTaskRows(this.db, query, limit, cursor));
  }

  submission(
    id: typesModule.SubmissionId,
    _context: chordTypes.Context,
  ): Promise<typesModule.SubmissionRecord | undefined> {
    return this.query(() => recordById<typesModule.SubmissionRecord>(this.db, "submissions", id));
  }

  scanSubmissions(
    query: typesModule.SubmissionQuery,
    limit: number,
    cursor: typesModule.Cursor | undefined,
    _context: chordTypes.Context,
  ): Promise<typesModule.Page<typesModule.SubmissionRecord, typesModule.Cursor>> {
    return this.query(() => scanSubmissionRows(this.db, query, limit, cursor));
  }

  submissionByRequest(
    conversationId: typesModule.ConversationId,
    requestId: string,
    _context: chordTypes.Context,
  ): Promise<typesModule.SubmissionRecord | undefined> {
    return this.query(() => submissionByRequestRow(this.db, conversationId, requestId));
  }

  findDocument(
    address: typesModule.DocumentAddress,
    at: typesModule.DocumentPoint,
    _context: chordTypes.Context,
  ): Promise<typesModule.DocumentRecord | undefined> {
    return this.query(() => findDocumentRow(this.db, address, at));
  }

  document(
    id: typesModule.DocumentId,
    at: typesModule.DocumentPoint,
    _context: chordTypes.Context,
  ): Promise<typesModule.StoredDocument | undefined> {
    return this.run(() =>
      Effect.promise(() =>
        this.db.transaction((transaction) =>
          Effect.runPromise(materializeDocument(transaction, id, at)),
        ),
      ),
    );
  }

  scanDocuments(
    query: typesModule.DocumentQuery,
    limit: number,
    cursor: typesModule.Cursor | undefined,
    _context: chordTypes.Context,
  ): Promise<typesModule.Page<typesModule.DocumentRecord, typesModule.Cursor>> {
    return this.query(() => scanDocumentRows(this.db, query, limit, cursor));
  }

  close(_context: chordTypes.Context): Promise<void> {
    if (this.closing === undefined) {
      this.closed = true;
      this.closing = Effect.runPromise(this.closeDatabase());
    }
    return this.closing;
  }

  private closeDatabase(): Effect.Effect<void> {
    return Effect.gen({ self: this }, function* () {
      if (this.admittedReads > 0) {
        const drained = Deferred.makeUnsafe<void>();
        this.readsDrained = drained;
        yield* Deferred.await(drained);
      }
      yield* Effect.promise(() => this.db.close());
    });
  }

  private admitRead<T>(read: Effect.Effect<T>): Promise<T> {
    return this.run(() => {
      this.admittedReads++;
      return read.pipe(
        Effect.ensuring(
          Effect.sync(() => {
            if (--this.admittedReads === 0 && this.readsDrained !== undefined)
              Deferred.doneUnsafe(this.readsDrained, Effect.void);
          }),
        ),
      );
    });
  }

  private run<T>(start: () => Effect.Effect<T>): Promise<T> {
    return Effect.runPromise(
      Effect.suspend(() => {
        this.assertOpen();
        return start();
      }),
    );
  }

  private query<T>(start: () => Promise<T>): Promise<T> {
    try {
      this.assertOpen();
      const pending = start();
      return Promise.resolve().then(() => pending);
    } catch (error) {
      return Promise.reject(error);
    }
  }

  private assertOpen(): void {
    if (this.closed) throw new Error("SqliteStorage is closed");
  }
}
