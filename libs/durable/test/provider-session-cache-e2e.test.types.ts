import type harnessTypes from "@msa/durable/harness.types";
import type durableTypes from "@msa/durable/index.types";

declare namespace providerSessionCacheE2eTestTypes {
  type Harness = harnessTypes.Harness;

  type Conversation = durableTypes.Conversation;

  type ConversationId = durableTypes.ConversationId;

  type EntryId = durableTypes.EntryId;
}

export type { providerSessionCacheE2eTestTypes as default };
