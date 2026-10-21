import ConversationBusy from "./errors/conversation-busy.ts";
import ReadAfterWrite from "./errors/read-after-write.ts";
import SessionFailed from "./errors/session-failed.ts";
import StorageRequestError from "./errors/storage-request-error.ts";

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  try {
    return String(error);
  } catch {
    return Object.prototype.toString.call(error);
  }
}

const errors = {
  ConversationBusy: ConversationBusy,
  ReadAfterWrite: ReadAfterWrite,
  SessionFailed: SessionFailed,
  StorageRequestError: StorageRequestError,
  errorMessage,
};

export default errors;
