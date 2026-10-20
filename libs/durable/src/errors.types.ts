import type conversationBusyTypes from "./errors/conversation-busy.types.ts";
import type readAfterWriteTypes from "./errors/read-after-write.types.ts";
import type sessionFailedTypes from "./errors/session-failed.types.ts";
import type storageRequestErrorTypes from "./errors/storage-request-error.types.ts";

declare namespace errorsTypes {
  type ConversationBusy = conversationBusyTypes.ConversationBusy;

  type ReadAfterWrite = readAfterWriteTypes.ReadAfterWrite;

  type SessionFailed = sessionFailedTypes.SessionFailed;

  type StorageRequestError = storageRequestErrorTypes.StorageRequestError;
}

export type { errorsTypes as default };
