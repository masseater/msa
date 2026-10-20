import type { Context } from "@msa/chord";
import { Effect } from "effect";

import errors from "../errors.ts";
import idsModule from "../ids.ts";
import type typesModule from "../types.types.ts";
import type memoryTypes from "./memory.types.ts";
import memoryKit from "./memory/kit.ts";
import type stateTypes from "./memory/state.types.ts";

const {
  apply: applyModule,
  documents: documentsModule,
  entries: entriesModule,
  scans,
  state: stateModule,
} = memoryKit;
const { addressKey, clone, createState, freeze, isAliveAt } = stateModule;
const { idFromNumber, seqFromNumber } = idsModule;
const {
  checkDocumentActions,
  checkGlobalIds,
  materializeDocument,
  prepareDocumentActions,
  resolveDocumentCopies,
} = documentsModule;
const { applyDocumentActions, applyTableWrite } = applyModule;
const {
  scanConversationIds,
  scanDocumentRecords,
  scanEntryRecords,
  scanSubmissionRecords,
  scanTaskRecords,
} = scans;
const { StorageRequestError } = errors;
const { latestHeadMarker, visibleEntries } = entriesModule;

type EntryRead = { readonly entry: typesModule.EntryRecord; readonly commitSeq: typesModule.Seq };

export default class MemoryStorage implements typesModule.Storage {
  private readonly state = createState();
  private nextId = 2;
  private nextSeq = 1;
  private closed = false;

  commit(writes: readonly typesModule.StorageWrite[], _context: Context): Promise<typesModule.Seq> {
    return this.read(() => this.prepareCommit(writes).apply());
  }

  prepareCommit(
    writes: readonly typesModule.StorageWrite[],
    seq: typesModule.Seq = seqFromNumber(this.nextSeq),
  ): memoryTypes.PreparedMemoryCommit {
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
      apply: () => {
        if (!applied) {
          applied = true;
          this.applyPreparedCommit(detachedWrites, documentActions, seq);
        }
        return seq;
      },
      seq,
      writes: detachedWrites,
    };
  }

  private applyPreparedCommit(
    prepared: readonly typesModule.StorageWrite[],
    documentActions: ReadonlyMap<typesModule.DocumentId, stateTypes.DocumentAction>,
    seq: typesModule.Seq,
  ): void {
    for (const write of prepared) {
      const id = applyTableWrite(this.state, write, seq);
      if (id !== undefined) this.nextId = Math.max(this.nextId, id + 1);
    }
    const created = applyDocumentActions(this.state, documentActions, seq);
    this.nextId = Math.max(this.nextId, created + 1);
    this.nextSeq = seq + 1;
  }

  mintId<I extends typesModule.Id<string>>(): Promise<I> {
    return this.read(() => {
      if (!Number.isSafeInteger(this.nextId)) throw new Error("ID space is exhausted");
      return idFromNumber<I>(this.nextId++);
    });
  }

  conversation(
    id: typesModule.ConversationId,
    _context: Context,
  ): Promise<typesModule.ConversationRecord | undefined> {
    return this.read(() => {
      const value = this.state.conversations.get(id);
      return value === undefined ? undefined : clone(value);
    });
  }

  scanConversations(
    query: typesModule.ConversationQuery,
    limit: number,
    cursor: typesModule.Cursor | undefined,
    _context: Context,
  ): Promise<typesModule.Page<typesModule.ConversationRecord, typesModule.Cursor>> {
    return this.read(() => scanConversationIds(this.state, query, limit, cursor));
  }

  entry(id: typesModule.EntryId, context: Context): Promise<EntryRead | undefined>;
  entry(
    conversationId: typesModule.ConversationId,
    id: typesModule.EntryId,
    context: Context,
  ): Promise<EntryRead | undefined>;
  entry(
    idOrConversationId: typesModule.EntryId | typesModule.ConversationId,
    idOrContext: typesModule.EntryId | Context,
    context?: Context,
  ): Promise<EntryRead | undefined> {
    return this.read(() => {
      if (context === undefined) {
        const id = idFromNumber<typesModule.EntryId>(idOrConversationId);
        const entry = this.state.entries.get(id);
        if (entry === undefined) return undefined;
        return { commitSeq: this.state.entryCommitSeqs.get(id)!, entry: clone(entry) };
      }
      if (typeof idOrContext !== "number")
        throw new StorageRequestError("Storage.entry() requires an entry ID");
      const conversationId = idFromNumber<typesModule.ConversationId>(idOrConversationId);
      const id = idFromNumber<typesModule.EntryId>(idOrContext);
      const entry = visibleEntries(this.state, conversationId, id, id).next().value;
      if (entry === undefined) return undefined;
      return { commitSeq: this.state.entryCommitSeqs.get(id)!, entry: clone(entry) };
    });
  }

  findLatestHeadMarker(
    conversationId: typesModule.ConversationId,
    atOrBeforeEntryId: typesModule.EntryId | undefined,
    _context: Context,
  ): Promise<(typesModule.EntryRecord & { readonly head: typesModule.EntryId }) | undefined> {
    return this.read(() => latestHeadMarker(this.state, conversationId, atOrBeforeEntryId));
  }

  scanEntries(
    query: typesModule.EntryQuery,
    limit: number,
    cursor: typesModule.Cursor | undefined,
    _context: Context,
  ): Promise<typesModule.Page<typesModule.EntryRecord, typesModule.Cursor>> {
    return this.read(() => scanEntryRecords(this.state, query, limit, cursor));
  }

  task(id: typesModule.TaskId, _context: Context): Promise<stateTypes.StoredTask | undefined> {
    return this.read(() => {
      const value = this.state.tasks.get(id);
      return value === undefined ? undefined : clone(value);
    });
  }

  scanTasks(
    query: typesModule.TaskQuery,
    limit: number,
    cursor: typesModule.Cursor | undefined,
    _context: Context,
  ): Promise<typesModule.Page<stateTypes.StoredTask, typesModule.Cursor>> {
    return this.read(() => scanTaskRecords(this.state, query, limit, cursor));
  }

  submission(
    id: typesModule.SubmissionId,
    _context: Context,
  ): Promise<typesModule.SubmissionRecord | undefined> {
    return this.read(() => {
      const value = this.state.submissions.get(id);
      return value === undefined ? undefined : clone(value);
    });
  }

  scanSubmissions(
    query: typesModule.SubmissionQuery,
    limit: number,
    cursor: typesModule.Cursor | undefined,
    _context: Context,
  ): Promise<typesModule.Page<typesModule.SubmissionRecord, typesModule.Cursor>> {
    return this.read(() => scanSubmissionRecords(this.state, query, limit, cursor));
  }

  submissionByRequest(
    conversationId: typesModule.ConversationId,
    requestId: string,
    _context: Context,
  ): Promise<typesModule.SubmissionRecord | undefined> {
    return this.read(() => {
      const id = this.state.submissionIdsByRequest.get(conversationId)?.get(requestId);
      if (id === undefined) return undefined;
      return clone(this.state.submissions.get(id)!);
    });
  }

  findDocument(
    address: typesModule.DocumentAddress,
    at: typesModule.DocumentPoint,
    _context: Context,
  ): Promise<typesModule.DocumentRecord | undefined> {
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
    id: typesModule.DocumentId,
    at: typesModule.DocumentPoint,
    _context: Context,
  ): Promise<typesModule.StoredDocument | undefined> {
    return this.read(() => {
      const stored = materializeDocument(this.state, id, at);
      return stored === undefined
        ? undefined
        : {
            deltasSinceBase: stored.deltasSinceBase,
            record: clone(stored.record),
            value: clone(stored.value),
            version: stored.version,
          };
    });
  }

  scanDocuments(
    query: typesModule.DocumentQuery,
    limit: number,
    cursor: typesModule.Cursor | undefined,
    _context: Context,
  ): Promise<typesModule.Page<typesModule.DocumentRecord, typesModule.Cursor>> {
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
