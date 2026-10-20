import type { JsonValue } from "@msa/chord";

import type typesModule from "../../types.types.ts";

declare namespace stateTypes {
  type StoredTask = typesModule.TaskRecord<JsonValue, JsonValue, JsonValue>;

  type TaskStatus = StoredTask["state"]["status"];

  type SubmissionStatus = typesModule.SubmissionRecord["status"];

  type TableName = "conversation" | "entry" | "task" | "submission" | "document";

  type DocumentRevision = typesModule.DocumentContent & { readonly seq: typesModule.Seq };

  type StoredDocumentState = {
    record: typesModule.DocumentRecord;
    revisions: DocumentRevision[];
  };

  type DocumentAction = {
    create?: typesModule.DocumentCreate;
    content?: typesModule.DocumentContent;
    retire: boolean;
  };

  type DocumentAddressIndex = {
    ids: typesModule.DocumentId[];
    currentId?: typesModule.DocumentId;
  };

  type State = {
    recordTypes: Map<typesModule.Id<string>, TableName>;
    conversations: Map<typesModule.ConversationId, typesModule.ConversationRecord>;
    conversationIds: typesModule.ConversationId[];
    conversationIdsByOwnerConversation: Map<
      typesModule.ConversationId,
      typesModule.ConversationId[]
    >;
    conversationIdsByOwnerTask: Map<typesModule.TaskId, typesModule.ConversationId[]>;
    entries: Map<typesModule.EntryId, typesModule.EntryRecord>;
    entryIds: Map<typesModule.ConversationId, typesModule.EntryId[]>;
    headEntryIds: Map<typesModule.ConversationId, typesModule.EntryId[]>;
    entryCommitSeqs: Map<typesModule.EntryId, typesModule.Seq>;
    tasks: Map<typesModule.TaskId, StoredTask>;
    taskIds: typesModule.TaskId[];
    taskIdsByStatus: Record<TaskStatus, typesModule.TaskId[]>;
    submissions: Map<typesModule.SubmissionId, typesModule.SubmissionRecord>;
    submissionIds: typesModule.SubmissionId[];
    submissionIdsByStatus: Record<SubmissionStatus, typesModule.SubmissionId[]>;
    submissionIdsByRequest: Map<typesModule.ConversationId, Map<string, typesModule.SubmissionId>>;
    documents: Map<typesModule.DocumentId, StoredDocumentState>;
    documentAddresses: Map<string, DocumentAddressIndex>;
    documentIdsByScope: Map<string, typesModule.DocumentId[]>;
  };
}

export type { stateTypes as default };
