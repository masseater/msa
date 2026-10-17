import { type Context, copyJson, type Draft, type JsonValue } from "@msa/chord";
import type { Change, Op, Prepared, Tracker } from "@msa/chord/delta";

import type { AnyDocDefinition } from "../documents.ts";
import type {
  ConversationId,
  ConversationRecord,
  DocumentAddress,
  DocumentCopySource,
  DocumentCreate,
  DocumentId,
  DocumentRecord,
  EntryId,
  JsonObject,
  Storage,
  StorageWrite,
  SubmissionId,
  SubmissionRecord,
  SubmissionSettlement,
  TaskId,
  TaskRecord,
} from "../types.ts";
import type { Transaction } from "./transaction.ts";

export type { Transaction };

export type AnyTaskRecord = TaskRecord<JsonValue, JsonValue, JsonValue>;

export type SubmissionChange =
  | SubmissionSettlement
  | { readonly status: "placed"; readonly entry: EntryId };

export const INTERNAL_SCAN_PAGE_SIZE = 256;
export const EMPTY_OPERATIONS: readonly Op[] = [];
export const TABLE_JSON_COPY_OPTIONS = { omitUndefinedProperties: true } as const;

export const copyTableJson = <T>(value: unknown): T =>
  copyJson(value, TABLE_JSON_COPY_OPTIONS) as T;

export type LoadedDocument = {
  readonly addressId: string;
  readonly record: DocumentRecord;
  storedVersion: number;
  readonly valueVersion: number;
  deltasSinceBase: number;
  readonly tracker: Tracker<JsonObject>;
};

export interface TransactionHost {
  readonly storage: Storage;
  now(): number;
  cached(addressId: string): LoadedDocument | undefined;
  load(
    definition: AnyDocDefinition,
    addressId: string,
    address: DocumentAddress,
    context: Context,
  ): Promise<LoadedDocument | undefined>;
  install(document: LoadedDocument): void;
  evict(addressId: string, recordId: DocumentId): void;
  conversationCreated(tx: Transaction, record: ConversationRecord): Promise<void>;
}

export type TransactionTask = {
  committedRead?: Promise<AnyTaskRecord | undefined>;
  write?: { readonly kind: "create" | "replace"; readonly record: AnyTaskRecord };
  publicationConversationId?: ConversationId;
};

export type TransactionScope = {
  readonly conversationId?: ConversationId;
  readonly taskId?: TaskId;
};

export type ForkCopyTarget = {
  readonly kind: "fork-copy";
  readonly record: DocumentCreate;
  readonly source: DocumentCopySource;
};

export type DocumentTarget =
  | { readonly kind: "loaded"; readonly document: LoadedDocument }
  | {
      readonly kind: "created";
      readonly record: DocumentCreate;
      readonly version: number;
      readonly tracker: Tracker<JsonObject>;
    }
  | ForkCopyTarget
  | { readonly kind: "retire-only"; readonly record: DocumentRecord };

export type DocumentEntry = {
  readonly addressId: string;
  readonly address: DocumentAddress;
  definition?: AnyDocDefinition;
  draftPromise?: Promise<Draft<JsonObject>>;
  target?: DocumentTarget;
  change?: Change<JsonObject>;
  prepared?: Prepared<JsonObject>;
  retireOnCommit: boolean;
};

export type DocumentPlan = {
  readonly addressId: string;
  readonly record: DocumentCreate | DocumentRecord;
  retire: boolean;
  content?: Extract<
    StorageWrite,
    { readonly type: "document.create" | "document.copy" | "document.change" }
  >;
  readonly change?: {
    readonly tracker: Tracker<JsonObject>;
    readonly prepared: Prepared<JsonObject>;
    readonly version: number;
    readonly loaded?: LoadedDocument;
    readonly definition?: AnyDocDefinition;
  };
  conversationId?: ConversationId | undefined;
};

export type TxState = {
  readonly self: Transaction;
  readonly host: TransactionHost;
  readonly context: Context;
  readonly scope: TransactionScope;
  readonly pendingOperations: Set<Promise<unknown>>;
  sealed: boolean;
  hasTableWrite: boolean;
  readonly writes: StorageWrite[];
  readonly createdConversationIds: Set<ConversationId>;
  readonly forkSourceConversationIds: Set<ConversationId>;
  readonly forkSourceDocumentIds: Set<DocumentId>;
  readonly tasksById: Map<TaskId, TransactionTask>;
  readonly submissions: Map<SubmissionId, SubmissionRecord>;
  readonly submissionChanges: { readonly id: SubmissionId; readonly change: SubmissionChange }[];
  readonly plans: DocumentPlan[];
  readonly documents: DocumentEntry[];
  readonly latestDocumentByAddress: Map<string, DocumentEntry>;
};
