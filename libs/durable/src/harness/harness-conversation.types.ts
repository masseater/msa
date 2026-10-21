import type ConversationImplClass from "./harness-conversation.ts";
import type typesModule from "./types.types.ts";

declare namespace harnessConversationTypes {
  type ConversationImpl<Tool extends typesModule.ToolRegistration> = ConversationImplClass<Tool>;
}

export type { harnessConversationTypes as default };
