export { ConversationBusy } from "./errors/conversation-busy.ts";
export { ReadAfterWrite } from "./errors/read-after-write.ts";
export { SessionFailed } from "./errors/session-failed.ts";
export { StorageRequestError } from "./errors/storage-request-error.ts";

export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  try {
    return String(error);
  } catch {
    return Object.prototype.toString.call(error);
  }
}
