import type { ConversationId } from "./types.ts";

export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  try {
    return String(error);
  } catch {
    return Object.prototype.toString.call(error);
  }
}

export class ReadAfterWrite extends Error {
  constructor(method: string) {
    super(`Tx.${method}() cannot read tables after the first table write`);
    this.name = "ReadAfterWrite";
  }
}

export class StorageRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StorageRequestError";
  }
}

export class SessionFailed extends Error {
  constructor(cause: unknown) {
    super("Session failed after a storage error; close and reopen it", { cause });
    this.name = "SessionFailed";
  }
}

export class ConversationBusy extends Error {
  readonly conversationId: ConversationId;

  constructor(conversationId: ConversationId) {
    super(`Conversation ${conversationId} is busy`);
    this.name = "ConversationBusy";
    this.conversationId = conversationId;
  }
}
