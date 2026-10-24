import { Schema } from "effect";

import type typesModule from "../types.types.ts";

const ConversationId = Schema.declare(
  (input: unknown): input is typesModule.ConversationId => typeof input === "number",
);

export default class ConversationBusy extends Schema.TaggedError<
  ConversationBusy,
  { readonly brand: unique symbol }
>()("ConversationBusy", {
  conversationId: ConversationId,
  message: Schema.String,
}) {
  static create(conversationId: typesModule.ConversationId): ConversationBusy {
    return ConversationBusy.make({
      conversationId,
      message: `Conversation ${conversationId} is busy`,
    });
  }
}
