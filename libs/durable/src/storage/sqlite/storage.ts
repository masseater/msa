import type { Context } from "@msa/chord";
import { Deferred, Effect } from "effect";

import { idFromNumber } from "../../ids.ts";
import type {
  ConversationId,
  ConversationQuery,
  ConversationRecord,
  Cursor,
  DocumentAddress,
  DocumentId,
  DocumentPoint,
  DocumentQuery,
  DocumentRecord,
  EntryId,
  EntryQuery,
  EntryRecord,
  Id,
  Page,
  Seq,
  Storage,
  StorageWrite,
  StoredDocument,
  SubmissionId,
  SubmissionQuery,
  SubmissionRecord,
  TaskId,
  TaskQuery,
} from "../../types.ts";
import { candidateNextId, commitIn, readMetadata } from "./commit.ts";
import type { SqliteDatabase } from "./database.ts";
import { materializeDocument, prepareDocumentActions } from "./documents.ts";
import { readEntries, readEntry, readLatestHeadMarker } from "./entries.ts";
import { applySqliteMigrations } from "./migrations.ts";
import {
  findDocumentRow,
  recordById,
  scanConversationRows,
  scanDocumentRows,
  scanSubmissionRows,
  scanTaskRows,
  submissionByRequestRow,
} from "./scans.ts";

type StoredTask = NonNullable<Awaited<ReturnType<Storage["task"]>>>;
type EntryRead = { readonly entry: EntryRecord; readonly commitSeq: Seq };

export class SqliteStorage implements Storage {
  private readonly db: SqliteDatabase;
  private nextId: number;
  private closed = false;
  private closing: Promise<void> | undefined;
  private admittedReads = 0;
  private readsDrained: Deferred.Deferred<void> | undefined;

  private constructor(db: SqliteDatabase, nextId: number) {
    this.db = db;
    this.nextId = nextId;
  }

  static open(db: SqliteDatabase): Promise<SqliteStorage> {
    return Effect.runPromise(
      Effect.gen(function* () {
        yield* Effect.promise(() => applySqliteMigrations(db));
        const metadata = yield* readMetadata(db);
        return new SqliteStorage(db, Number(metadata.next_id));
      }).pipe(Effect.onError(() => Effect.ignoreCause(Effect.promise(() => db.close())))),
    );
  }

  commit(writes: readonly StorageWrite[], _context: Context): Promise<Seq> {
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

  mintId<I extends Id<string>>(): Promise<I> {
    return this.query(() => {
      if (!Number.isSafeInteger(this.nextId)) throw new Error("ID space is exhausted");
      return Promise.resolve(idFromNumber<I>(this.nextId++));
    });
  }

  conversation(id: ConversationId, _context: Context): Promise<ConversationRecord | undefined> {
    return this.query(() => recordById<ConversationRecord>(this.db, "conversations", id));
  }

  scanConversations(
    query: ConversationQuery,
    limit: number,
    cursor: Cursor | undefined,
    _context: Context,
  ): Promise<Page<ConversationRecord, Cursor>> {
    return this.query(() => scanConversationRows(this.db, query, limit, cursor));
  }

  entry(id: EntryId, context: Context): Promise<EntryRead | undefined>;
  entry(
    conversationId: ConversationId,
    id: EntryId,
    context: Context,
  ): Promise<EntryRead | undefined>;
  entry(
    idOrConversationId: EntryId | ConversationId,
    idOrContext: EntryId | Context,
    context?: Context,
  ): Promise<EntryRead | undefined> {
    return this.admitRead(readEntry(this.db, idOrConversationId, idOrContext, context));
  }

  findLatestHeadMarker(
    conversationId: ConversationId,
    atOrBeforeEntryId: EntryId | undefined,
    _context: Context,
  ): Promise<(EntryRecord & { readonly head: EntryId }) | undefined> {
    return this.admitRead(readLatestHeadMarker(this.db, conversationId, atOrBeforeEntryId));
  }

  scanEntries(
    query: EntryQuery,
    limit: number,
    cursor: Cursor | undefined,
    _context: Context,
  ): Promise<Page<EntryRecord, Cursor>> {
    return this.admitRead(readEntries(this.db, query, limit, cursor));
  }

  task(id: TaskId, _context: Context): Promise<StoredTask | undefined> {
    return this.query(() => recordById<StoredTask>(this.db, "tasks", id));
  }

  scanTasks(
    query: TaskQuery,
    limit: number,
    cursor: Cursor | undefined,
    _context: Context,
  ): Promise<Page<StoredTask, Cursor>> {
    return this.query(() => scanTaskRows(this.db, query, limit, cursor));
  }

  submission(id: SubmissionId, _context: Context): Promise<SubmissionRecord | undefined> {
    return this.query(() => recordById<SubmissionRecord>(this.db, "submissions", id));
  }

  scanSubmissions(
    query: SubmissionQuery,
    limit: number,
    cursor: Cursor | undefined,
    _context: Context,
  ): Promise<Page<SubmissionRecord, Cursor>> {
    return this.query(() => scanSubmissionRows(this.db, query, limit, cursor));
  }

  submissionByRequest(
    conversationId: ConversationId,
    requestId: string,
    _context: Context,
  ): Promise<SubmissionRecord | undefined> {
    return this.query(() => submissionByRequestRow(this.db, conversationId, requestId));
  }

  findDocument(
    address: DocumentAddress,
    at: DocumentPoint,
    _context: Context,
  ): Promise<DocumentRecord | undefined> {
    return this.query(() => findDocumentRow(this.db, address, at));
  }

  document(
    id: DocumentId,
    at: DocumentPoint,
    _context: Context,
  ): Promise<StoredDocument | undefined> {
    return this.run(() =>
      Effect.promise(() =>
        this.db.transaction((transaction) =>
          Effect.runPromise(materializeDocument(transaction, id, at)),
        ),
      ),
    );
  }

  scanDocuments(
    query: DocumentQuery,
    limit: number,
    cursor: Cursor | undefined,
    _context: Context,
  ): Promise<Page<DocumentRecord, Cursor>> {
    return this.query(() => scanDocumentRows(this.db, query, limit, cursor));
  }

  close(_context: Context): Promise<void> {
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
