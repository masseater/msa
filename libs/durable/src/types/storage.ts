import type { Context, JsonValue } from "@msa/chord";
import type { Op } from "@msa/chord/delta";

import type {
  DocumentAddress,
  DocumentContent,
  DocumentCopySource,
  DocumentCreate,
  DocumentPoint,
  DocumentQuery,
  DocumentRecord,
  StoredDocument,
} from "./documents.ts";
import type {
  ConversationId,
  DocumentId,
  EntryId,
  Id,
  JsonObject,
  Seq,
  SubmissionId,
  TaskId,
} from "./ids.ts";
import type { ConversationRecord, EntryRecord, SubmissionRecord } from "./records.ts";
import type { TaskRecord, TaskState } from "./tasks.ts";

export type Page<T, C> = {
  readonly items: readonly T[];
  readonly next?: C;
};

export type Cursor = Readonly<Record<string, JsonValue>>;

export type ScanOrder = "ascending" | "descending";

export type ConversationQuery = {
  readonly ownerConversationId?: ConversationId;
  readonly ownerTaskId?: TaskId;
  readonly order?: ScanOrder;
};

export type EntryQuery = {
  readonly conversationId: ConversationId;
  readonly minEntryId?: EntryId;
  readonly maxEntryId?: EntryId;
  readonly order?: ScanOrder;
};

export type TaskQuery = {
  readonly conversationId?: ConversationId;
  readonly kind?: string;
  readonly status?: TaskState<JsonValue, JsonValue>["status"];
  readonly abortRequested?: boolean;
  readonly background?: boolean;
  readonly order?: ScanOrder;
};

export type SubmissionQuery = {
  readonly conversationId?: ConversationId;
  readonly status?: SubmissionRecord["status"];
  readonly order?: ScanOrder;
};

export type StorageWrite =
  | { readonly type: "conversation"; readonly value: ConversationRecord }
  | { readonly type: "entry"; readonly value: EntryRecord }
  | { readonly type: "task"; readonly value: TaskRecord<JsonValue, JsonValue, JsonValue> }
  | { readonly type: "submission"; readonly value: SubmissionRecord }
  | {
      readonly type: "document.create";
      readonly record: DocumentCreate;
      readonly content: Extract<DocumentContent, { readonly kind: "base" }>;
    }
  | {
      readonly type: "document.copy";
      readonly record: DocumentCreate;
      readonly source: DocumentCopySource;
    }
  | {
      readonly type: "document.change";
      readonly id: DocumentId;
      readonly content: DocumentContent;
    }
  | { readonly type: "document.retire"; readonly id: DocumentId };

export type DocumentCommitChange =
  | {
      readonly type: "document";
      readonly record: DocumentRecord;
      readonly conversationId: ConversationId | undefined;
      readonly version: number | undefined;
      readonly value: JsonObject | null;
      readonly ops: readonly Op[];
    }
  | {
      readonly type: "document.copy";
      readonly record: DocumentRecord;
      readonly conversationId: ConversationId;
      readonly source: DocumentCopySource;
    };

export type TableCommitChange = Extract<
  StorageWrite,
  { readonly type: "conversation" | "entry" | "task" | "submission" }
>;

export type CommitChange = TableCommitChange | DocumentCommitChange;

export type CommitPublication = {
  readonly seq: Seq;
  readonly changes: readonly CommitChange[];
};

export interface Storage {
  commit(writes: readonly StorageWrite[], context: Context): Promise<Seq>;

  mintId<I extends Id<string>>(): Promise<I>;

  conversation(id: ConversationId, context: Context): Promise<ConversationRecord | undefined>;

  scanConversations(
    query: ConversationQuery,
    limit: number,
    cursor: Cursor | undefined,
    context: Context,
  ): Promise<Page<ConversationRecord, Cursor>>;

  entry(
    id: EntryId,
    context: Context,
  ): Promise<{ readonly entry: EntryRecord; readonly commitSeq: Seq } | undefined>;
  entry(
    conversationId: ConversationId,
    id: EntryId,
    context: Context,
  ): Promise<{ readonly entry: EntryRecord; readonly commitSeq: Seq } | undefined>;

  findLatestHeadMarker(
    conversationId: ConversationId,
    atOrBeforeEntryId: EntryId | undefined,
    context: Context,
  ): Promise<(EntryRecord & { readonly head: EntryId }) | undefined>;

  scanEntries(
    query: EntryQuery,
    limit: number,
    cursor: Cursor | undefined,
    context: Context,
  ): Promise<Page<EntryRecord, Cursor>>;

  task(
    id: TaskId,
    context: Context,
  ): Promise<TaskRecord<JsonValue, JsonValue, JsonValue> | undefined>;

  scanTasks(
    query: TaskQuery,
    limit: number,
    cursor: Cursor | undefined,
    context: Context,
  ): Promise<Page<TaskRecord<JsonValue, JsonValue, JsonValue>, Cursor>>;

  submission(id: SubmissionId, context: Context): Promise<SubmissionRecord | undefined>;

  scanSubmissions(
    query: SubmissionQuery,
    limit: number,
    cursor: Cursor | undefined,
    context: Context,
  ): Promise<Page<SubmissionRecord, Cursor>>;

  submissionByRequest(
    conversationId: ConversationId,
    requestId: string,
    context: Context,
  ): Promise<SubmissionRecord | undefined>;

  findDocument(
    address: DocumentAddress,
    at: DocumentPoint,
    context: Context,
  ): Promise<DocumentRecord | undefined>;

  document(
    id: DocumentId,
    at: DocumentPoint,
    context: Context,
  ): Promise<StoredDocument | undefined>;

  scanDocuments(
    query: DocumentQuery,
    limit: number,
    cursor: Cursor | undefined,
    context: Context,
  ): Promise<Page<DocumentRecord, Cursor>>;

  close(context: Context): Promise<void>;
}
