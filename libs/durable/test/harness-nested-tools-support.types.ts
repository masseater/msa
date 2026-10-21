import type durableTypes from "@msa/durable/index.types";

import type harnessNestedToolsSupport from "./harness-nested-tools-support.ts";

declare namespace harnessNestedToolsSupportTypes {
  type Tool = durableTypes.ToolRegistration<typeof harnessNestedToolsSupport.Parameters>;

  type EntryRecord = durableTypes.EntryRecord;

  type Harness = durableTypes.Harness;

  type NestedToolExecutionResult = durableTypes.NestedToolExecutionResult;
}

export type { harnessNestedToolsSupportTypes as default };
