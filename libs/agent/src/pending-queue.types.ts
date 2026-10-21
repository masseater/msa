import type PendingMessageQueueClass from "./pending-queue.ts";
import type typesModule from "./types.ts";

declare namespace pendingQueueTypes {
  type QueuedEntry = { readonly message: typesModule.AgentMessage; readonly sequence: number };

  type PendingMessageQueue = PendingMessageQueueClass;
}

export type { pendingQueueTypes as default };
