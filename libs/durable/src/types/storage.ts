import type deltaTypes from "@msa/chord/delta.types";
import type chordTypes from "@msa/chord/index.types";

import type documentsTypes from "./documents.types.ts";
import type idsTypes from "./ids.types.ts";
import type recordsTypes from "./records.ts";
import type tasksTypes from "./tasks.ts";

declare namespace storageTypes {
  type Page<T, C> = {
    readonly items: readonly T[];
    readonly next?: C;
  };

  type Cursor = Readonly<Record<string, chordTypes.JsonValue>>;

  type ScanOrder = "ascending" | "descending";

  type ConversationQuery = {
    readonly ownerConversationId?: idsTypes.ConversationId;
    readonly ownerTaskId?: idsTypes.TaskId;
    readonly order?: ScanOrder;
  };

  type EntryQuery = {
    readonly conversationId: idsTypes.ConversationId;
    readonly minEntryId?: idsTypes.EntryId;
    readonly maxEntryId?: idsTypes.EntryId;
    readonly order?: ScanOrder;
  };

  type TaskQuery = {
    readonly conversationId?: idsTypes.ConversationId;
    readonly kind?: string;
    readonly status?: tasksTypes.TaskState<chordTypes.JsonValue, chordTypes.JsonValue>["status"];
    readonly abortRequested?: boolean;
    readonly background?: boolean;
    readonly order?: ScanOrder;
  };

  type SubmissionQuery = {
    readonly conversationId?: idsTypes.ConversationId;
    readonly status?: recordsTypes.SubmissionRecord["status"];
    readonly order?: ScanOrder;
  };

  type StorageWrite =
    | { readonly type: "conversation"; readonly value: recordsTypes.ConversationRecord }
    | { readonly type: "entry"; readonly value: recordsTypes.EntryRecord }
    | {
        readonly type: "task";
        readonly value: tasksTypes.TaskRecord<
          chordTypes.JsonValue,
          chordTypes.JsonValue,
          chordTypes.JsonValue
        >;
      }
    | { readonly type: "submission"; readonly value: recordsTypes.SubmissionRecord }
    | {
        readonly type: "document.create";
        readonly record: documentsTypes.DocumentCreate;
        readonly content: Extract<documentsTypes.DocumentContent, { readonly kind: "base" }>;
      }
    | {
        readonly type: "document.copy";
        readonly record: documentsTypes.DocumentCreate;
        readonly source: documentsTypes.DocumentCopySource;
      }
    | {
        readonly type: "document.change";
        readonly id: idsTypes.DocumentId;
        readonly content: documentsTypes.DocumentContent;
      }
    | { readonly type: "document.retire"; readonly id: idsTypes.DocumentId };

  type DocumentCommitChange =
    | {
        readonly type: "document";
        readonly record: documentsTypes.DocumentRecord;
        readonly conversationId: idsTypes.ConversationId | undefined;
        readonly version: number | undefined;
        readonly value: idsTypes.JsonObject | null;
        readonly ops: readonly deltaTypes.Op[];
      }
    | {
        readonly type: "document.copy";
        readonly record: documentsTypes.DocumentRecord;
        readonly conversationId: idsTypes.ConversationId;
        readonly source: documentsTypes.DocumentCopySource;
      };

  type TableCommitChange = Extract<
    StorageWrite,
    { readonly type: "conversation" | "entry" | "task" | "submission" }
  >;

  type CommitChange = TableCommitChange | DocumentCommitChange;

  type CommitPublication = {
    readonly seq: idsTypes.Seq;
    readonly changes: readonly CommitChange[];
  };

  interface Storage {
    commit(writes: readonly StorageWrite[], context: chordTypes.Context): Promise<idsTypes.Seq>;

    mintId<I extends idsTypes.Id<string>>(): Promise<I>;

    conversation(
      id: idsTypes.ConversationId,
      context: chordTypes.Context,
    ): Promise<recordsTypes.ConversationRecord | undefined>;

    scanConversations(
      query: ConversationQuery,
      limit: number,
      cursor: Cursor | undefined,
      context: chordTypes.Context,
    ): Promise<Page<recordsTypes.ConversationRecord, Cursor>>;

    entry(
      id: idsTypes.EntryId,
      context: chordTypes.Context,
    ): Promise<
      { readonly entry: recordsTypes.EntryRecord; readonly commitSeq: idsTypes.Seq } | undefined
    >;
    entry(
      conversationId: idsTypes.ConversationId,
      id: idsTypes.EntryId,
      context: chordTypes.Context,
    ): Promise<
      { readonly entry: recordsTypes.EntryRecord; readonly commitSeq: idsTypes.Seq } | undefined
    >;

    findLatestHeadMarker(
      conversationId: idsTypes.ConversationId,
      atOrBeforeEntryId: idsTypes.EntryId | undefined,
      context: chordTypes.Context,
    ): Promise<(recordsTypes.EntryRecord & { readonly head: idsTypes.EntryId }) | undefined>;

    scanEntries(
      query: EntryQuery,
      limit: number,
      cursor: Cursor | undefined,
      context: chordTypes.Context,
    ): Promise<Page<recordsTypes.EntryRecord, Cursor>>;

    task(
      id: idsTypes.TaskId,
      context: chordTypes.Context,
    ): Promise<
      | tasksTypes.TaskRecord<chordTypes.JsonValue, chordTypes.JsonValue, chordTypes.JsonValue>
      | undefined
    >;

    scanTasks(
      query: TaskQuery,
      limit: number,
      cursor: Cursor | undefined,
      context: chordTypes.Context,
    ): Promise<
      Page<
        tasksTypes.TaskRecord<chordTypes.JsonValue, chordTypes.JsonValue, chordTypes.JsonValue>,
        Cursor
      >
    >;

    submission(
      id: idsTypes.SubmissionId,
      context: chordTypes.Context,
    ): Promise<recordsTypes.SubmissionRecord | undefined>;

    scanSubmissions(
      query: SubmissionQuery,
      limit: number,
      cursor: Cursor | undefined,
      context: chordTypes.Context,
    ): Promise<Page<recordsTypes.SubmissionRecord, Cursor>>;

    submissionByRequest(
      conversationId: idsTypes.ConversationId,
      requestId: string,
      context: chordTypes.Context,
    ): Promise<recordsTypes.SubmissionRecord | undefined>;

    findDocument(
      address: documentsTypes.DocumentAddress,
      at: documentsTypes.DocumentPoint,
      context: chordTypes.Context,
    ): Promise<documentsTypes.DocumentRecord | undefined>;

    document(
      id: idsTypes.DocumentId,
      at: documentsTypes.DocumentPoint,
      context: chordTypes.Context,
    ): Promise<documentsTypes.StoredDocument | undefined>;

    scanDocuments(
      query: documentsTypes.DocumentQuery,
      limit: number,
      cursor: Cursor | undefined,
      context: chordTypes.Context,
    ): Promise<Page<documentsTypes.DocumentRecord, Cursor>>;

    close(context: chordTypes.Context): Promise<void>;
  }
}

export type { storageTypes as default };
