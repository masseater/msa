import type durableTypes from "@msa/durable/index.types";

import type harnessToolsSupport from "./harness-tools-support.ts";

declare namespace harnessToolsSupportTypes {
  type Echo = durableTypes.ToolRegistration<typeof harnessToolsSupport.EchoParameters>;

  type Execute = Echo["execute"];

  type Conversation = durableTypes.Conversation;

  type EntryRecord = durableTypes.EntryRecord;

  type Harness = durableTypes.Harness;
}

export type { harnessToolsSupportTypes as default };
