import type conversationBusyTypes from "./conversation-busy.types.ts";
import type readAfterWriteTypes from "./read-after-write.types.ts";
import type sessionFailedTypes from "./session-failed.types.ts";
import type storageRequestErrorTypes from "./storage-request-error.types.ts";

declare namespace errorsTypes {
  type ConversationBusy = conversationBusyTypes.ConversationBusy;
  type ReadAfterWrite = readAfterWriteTypes.ReadAfterWrite;
  type SessionFailed = sessionFailedTypes.SessionFailed;
  type StorageRequestError = storageRequestErrorTypes.StorageRequestError;
}

export type { errorsTypes as default };
