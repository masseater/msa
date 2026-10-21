import type durableTypes from "@msa/durable/index.types";

import type chatSupportTypes from "./chat-support.types.ts";

declare namespace harnessInputEntriesSupportTypes {
  type ChatSetup = chatSupportTypes.ChatSetup;

  type Conversation = durableTypes.Conversation;

  type EntryRecord = durableTypes.EntryRecord;

  type Harness = durableTypes.Harness;
}

export type { harnessInputEntriesSupportTypes as default };
