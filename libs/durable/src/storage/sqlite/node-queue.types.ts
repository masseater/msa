import type SerialOperationQueueClass from "./node-queue.ts";

declare namespace nodeQueueTypes {
  type SerialOperationQueue = SerialOperationQueueClass;
}

export type { nodeQueueTypes as default };
