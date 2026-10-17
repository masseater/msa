import { Data } from "effect";

import type { ConversationId } from "../types.ts";

export class ConversationBusy extends Data.TaggedError("ConversationBusy")<{
  readonly message: string;
  readonly conversationId: ConversationId;
}> {
  constructor(conversationId: ConversationId) {
    super({ message: `Conversation ${conversationId} is busy`, conversationId });
  }
}
