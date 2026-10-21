import type reply from "./reply.ts";

declare namespace replyTypes {
  interface Usage {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
    reasoning?: number;
  }

  type ReplyBuilder = ReturnType<typeof reply.createReply>;
}

export type { replyTypes as default };
