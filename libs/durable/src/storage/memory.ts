import type { Context } from "@msa/chord";
import { Effect } from "effect";

import { StorageRequestError } from "../errors.ts";
import { idFromNumber, seqFromNumber } from "../ids.ts";
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
} from "../types.ts";
import { applyDocumentActions, applyTableWrite } from "./memory/apply.ts";
import {
  checkDocumentActions,
  checkGlobalIds,
  materializeDocument,
  prepareDocumentActions,
  resolveDocumentCopies,
} from "./memory/documents.ts";
import { latestHeadMarker, visibleEntries } from "./memory/entries.ts";
import {
  scanConversationIds,
  scanDocumentRecords,
  scanEntryRecords,
  scanSubmissionRecords,
  scanTaskRecords,
} from "./memory/scans.ts";
import {
  addressKey,
  clone,
  createState,
  type DocumentAction,
  freeze,
  isAliveAt,
  type StoredTask,
} from "./memory/state.ts";

export interface PreparedMemoryCommit {
  readonly seq: Seq;
  readonly writes: readonly StorageWrite[];
  apply(): Seq;
}

type EntryRead = { readonly entry: EntryRecord; readonly commitSeq: Seq };

export class MemoryStorage implements Storage {
  private readonly state = createState();
  private nextId = 2;
  private nextSeq = 1;
  private closed = false;

  commit(writes: readonly StorageWrite[], _context: Context): Promise<Seq> {
    return this.read(() => this.prepareCommit(writes).apply());
  }

  prepareCommit(
    writes: readonly StorageWrite[],
    seq: Seq = seqFromNumber(this.nextSeq),
  ): PreparedMemoryCommit {
    this.assertOpen();
    if (!Number.isSafeInteger(seq) || seq < this.nextSeq) {
      throw new Error(`Commit sequence ${seq} does not strictly increase`);
    }
    const detachedWrites = freeze(
      resolveDocumentCopies(
        this.state,
        writes.map((write) => clone(write)),
      ),
    );
    checkGlobalIds(this.state, detachedWrites);
    const documentActions = prepareDocumentActions(detachedWrites);
    checkDocumentActions(this.state, documentActions);
    let applied = false;
    return {
      seq,
      writes: detachedWrites,
      apply: () => {
        if (!applied) {
          applied = true;
          this.applyPreparedCommit(detachedWrites, documentActions, seq);
        }
        return seq;
      },
    };
  }

  private applyPreparedCommit(
    prepared: readonly StorageWrite[],
    documentActions: ReadonlyMap<DocumentId, DocumentAction>,
    seq: Seq,
  ): void {
    for (const write of prepared) {
      const id = applyTableWrite(this.state, write, seq);
      if (id !== undefined) this.nextId = Math.max(this.nextId, id + 1);
    }
    const created = applyDocumentActions(this.state, documentActions, seq);
    this.nextId = Math.max(this.nextId, created + 1);
    this.nextSeq = seq + 1;
  }

  mintId<I extends Id<string>>(): Promise<I> {
    return this.read(() => {
      if (!Number.isSafeInteger(this.nextId)) throw new Error("ID space is exhausted");
      return idFromNumber<I>(this.nextId++);
    });
  }

  conversation(id: ConversationId, _context: Context): Promise<ConversationRecord | undefined> {
    return this.read(() => {
      const value = this.state.conversations.get(id);
      return value === undefined ? undefined : clone(value);
    });
  }

  scanConversations(
    query: ConversationQuery,
    limit: number,
    cursor: Cursor | undefined,
    _context: Context,
  ): Promise<Page<ConversationRecord, Cursor>> {
    return this.read(() => scanConversationIds(this.state, query, limit, cursor));
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
    return this.read(() => {
      if (context === undefined) {
        const id = idFromNumber<EntryId>(idOrConversationId);
        const entry = this.state.entries.get(id);
        if (entry === undefined) return undefined;
        return { entry: clone(entry), commitSeq: this.state.entryCommitSeqs.get(id)! };
      }
      if (typeof idOrContext !== "number")
        throw new StorageRequestError("Storage.entry() requires an entry ID");
      const conversationId = idFromNumber<ConversationId>(idOrConversationId);
      const id = idFromNumber<EntryId>(idOrContext);
      const entry = visibleEntries(this.state, conversationId, id, id).next().value;
      if (entry === undefined) return undefined;
      return { entry: clone(entry), commitSeq: this.state.entryCommitSeqs.get(id)! };
    });
  }

  findLatestHeadMarker(
    conversationId: ConversationId,
    atOrBeforeEntryId: EntryId | undefined,
    _context: Context,
  ): Promise<(EntryRecord & { readonly head: EntryId }) | undefined> {
    return this.read(() => latestHeadMarker(this.state, conversationId, atOrBeforeEntryId));
  }

  scanEntries(
    query: EntryQuery,
    limit: number,
    cursor: Cursor | undefined,
    _context: Context,
  ): Promise<Page<EntryRecord, Cursor>> {
    return this.read(() => scanEntryRecords(this.state, query, limit, cursor));
  }

  task(id: TaskId, _context: Context): Promise<StoredTask | undefined> {
    return this.read(() => {
      const value = this.state.tasks.get(id);
      return value === undefined ? undefined : clone(value);
    });
  }

  scanTasks(
    query: TaskQuery,
    limit: number,
    cursor: Cursor | undefined,
    _context: Context,
  ): Promise<Page<StoredTask, Cursor>> {
    return this.read(() => scanTaskRecords(this.state, query, limit, cursor));
  }

  submission(id: SubmissionId, _context: Context): Promise<SubmissionRecord | undefined> {
    return this.read(() => {
      const value = this.state.submissions.get(id);
      return value === undefined ? undefined : clone(value);
    });
  }

  scanSubmissions(
    query: SubmissionQuery,
    limit: number,
    cursor: Cursor | undefined,
    _context: Context,
  ): Promise<Page<SubmissionRecord, Cursor>> {
    return this.read(() => scanSubmissionRecords(this.state, query, limit, cursor));
  }

  submissionByRequest(
    conversationId: ConversationId,
    requestId: string,
    _context: Context,
  ): Promise<SubmissionRecord | undefined> {
    return this.read(() => {
      const id = this.state.submissionIdsByRequest.get(conversationId)?.get(requestId);
      if (id === undefined) return undefined;
      return clone(this.state.submissions.get(id)!);
    });
  }

  findDocument(
    address: DocumentAddress,
    at: DocumentPoint,
    _context: Context,
  ): Promise<DocumentRecord | undefined> {
    return this.read(() => {
      const index = this.state.documentAddresses.get(addressKey(address));
      if (at === "current") {
        return index?.currentId === undefined
          ? undefined
          : clone(this.state.documents.get(index.currentId)!.record);
      }
      for (const id of index?.ids ?? []) {
        const record = this.state.documents.get(id)!.record;
        if (isAliveAt(record, at)) return clone(record);
      }
      return undefined;
    });
  }

  document(
    id: DocumentId,
    at: DocumentPoint,
    _context: Context,
  ): Promise<StoredDocument | undefined> {
    return this.read(() => {
      const stored = materializeDocument(this.state, id, at);
      return stored === undefined
        ? undefined
        : {
            record: clone(stored.record),
            version: stored.version,
            value: clone(stored.value),
            deltasSinceBase: stored.deltasSinceBase,
          };
    });
  }

  scanDocuments(
    query: DocumentQuery,
    limit: number,
    cursor: Cursor | undefined,
    _context: Context,
  ): Promise<Page<DocumentRecord, Cursor>> {
    return this.read(() => scanDocumentRecords(this.state, query, limit, cursor));
  }

  close(_context: Context): Promise<void> {
    return Effect.runPromise(
      Effect.sync(() => {
        this.closed = true;
      }),
    );
  }

  private read<T>(run: () => T): Promise<T> {
    return Effect.runPromise(
      Effect.sync(() => {
        this.assertOpen();
        return run();
      }),
    );
  }

  private assertOpen(): void {
    if (this.closed) throw new Error("MemoryStorage is closed");
  }
}
