import { Data } from "effect";

import type typesModule from "../types.types.ts";

export default class ConversationBusy extends Data.TaggedError("ConversationBusy")<{
  readonly message: string;
  readonly conversationId: typesModule.ConversationId;
}> {
  constructor(conversationId: typesModule.ConversationId) {
    super({ conversationId, message: `Conversation ${conversationId} is busy` });
  }
}
