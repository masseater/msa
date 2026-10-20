import type deltaTypes from "@msa/chord/delta.types";
import type chordTypes from "@msa/chord/index.types";

import type documentsTypes from "../documents.types.ts";
import type typesModule from "../types.types.ts";
import type transactionTypes from "./transaction.types.ts";

declare namespace transactionTypesModule {
  type AnyTaskRecord = typesModule.TaskRecord<
    chordTypes.JsonValue,
    chordTypes.JsonValue,
    chordTypes.JsonValue
  >;

  type SubmissionChange =
    | typesModule.SubmissionSettlement
    | { readonly status: "placed"; readonly entry: typesModule.EntryId };

  type LoadedDocument = {
    readonly addressId: string;
    readonly record: typesModule.DocumentRecord;
    storedVersion: number;
    readonly valueVersion: number;
    deltasSinceBase: number;
    readonly tracker: deltaTypes.Tracker<typesModule.JsonObject>;
  };

  interface TransactionHost {
    readonly storage: typesModule.Storage;
    now(): number;
    cached(addressId: string): LoadedDocument | undefined;
    load(
      definition: documentsTypes.AnyDocDefinition,
      addressId: string,
      address: typesModule.DocumentAddress,
      context: chordTypes.Context,
    ): Promise<LoadedDocument | undefined>;
    install(document: LoadedDocument): void;
    evict(addressId: string, recordId: typesModule.DocumentId): void;
    conversationCreated(
      tx: transactionTypes.Transaction,
      record: typesModule.ConversationRecord,
    ): Promise<void>;
  }

  type TransactionTask = {
    committedRead?: Promise<AnyTaskRecord | undefined>;
    write?: { readonly kind: "create" | "replace"; readonly record: AnyTaskRecord };
    publicationConversationId?: typesModule.ConversationId;
  };

  type TransactionScope = {
    readonly conversationId?: typesModule.ConversationId;
    readonly taskId?: typesModule.TaskId;
  };

  type ForkCopyTarget = {
    readonly kind: "fork-copy";
    readonly record: typesModule.DocumentCreate;
    readonly source: typesModule.DocumentCopySource;
  };

  type DocumentTarget =
    | { readonly kind: "loaded"; readonly document: LoadedDocument }
    | {
        readonly kind: "created";
        readonly record: typesModule.DocumentCreate;
        readonly version: number;
        readonly tracker: deltaTypes.Tracker<typesModule.JsonObject>;
      }
    | ForkCopyTarget
    | { readonly kind: "retire-only"; readonly record: typesModule.DocumentRecord };

  type DocumentEntry = {
    readonly addressId: string;
    readonly address: typesModule.DocumentAddress;
    definition?: documentsTypes.AnyDocDefinition;
    draftPromise?: Promise<chordTypes.Draft<typesModule.JsonObject>>;
    target?: DocumentTarget;
    change?: deltaTypes.Change<typesModule.JsonObject>;
    prepared?: deltaTypes.Prepared<typesModule.JsonObject>;
    retireOnCommit: boolean;
  };

  type DocumentPlan = {
    readonly addressId: string;
    readonly record: typesModule.DocumentCreate | typesModule.DocumentRecord;
    retire: boolean;
    content?: Extract<
      typesModule.StorageWrite,
      { readonly type: "document.create" | "document.copy" | "document.change" }
    >;
    readonly change?: {
      readonly tracker: deltaTypes.Tracker<typesModule.JsonObject>;
      readonly prepared: deltaTypes.Prepared<typesModule.JsonObject>;
      readonly version: number;
      readonly loaded?: LoadedDocument;
      readonly definition?: documentsTypes.AnyDocDefinition;
    };
    conversationId?: typesModule.ConversationId | undefined;
  };

  type TxState = {
    readonly self: transactionTypes.Transaction;
    readonly host: TransactionHost;
    readonly context: chordTypes.Context;
    readonly scope: TransactionScope;
    readonly pendingOperations: Set<Promise<unknown>>;
    sealed: boolean;
    hasTableWrite: boolean;
    readonly writes: typesModule.StorageWrite[];
    readonly createdConversationIds: Set<typesModule.ConversationId>;
    readonly forkSourceConversationIds: Set<typesModule.ConversationId>;
    readonly forkSourceDocumentIds: Set<typesModule.DocumentId>;
    readonly tasksById: Map<typesModule.TaskId, TransactionTask>;
    readonly submissions: Map<typesModule.SubmissionId, typesModule.SubmissionRecord>;
    readonly submissionChanges: {
      readonly id: typesModule.SubmissionId;
      readonly change: SubmissionChange;
    }[];
    readonly plans: DocumentPlan[];
    readonly documents: DocumentEntry[];
    readonly latestDocumentByAddress: Map<string, DocumentEntry>;
  };

  type Transaction = transactionTypes.Transaction;
}

export type { transactionTypesModule as default };
