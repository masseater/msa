import type SerialQueueClass from "./cloudflare-queue.ts";

declare namespace cloudflareQueueTypes {
  type SerialQueue = SerialQueueClass;
}

export type { cloudflareQueueTypes as default };
