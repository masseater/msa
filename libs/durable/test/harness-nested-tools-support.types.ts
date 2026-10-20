import type { ToolRegistration } from "@msa/durable";

import type harnessNestedToolsSupport from "./harness-nested-tools-support.ts";

declare namespace harnessNestedToolsSupportTypes {
  type Tool = ToolRegistration<typeof harnessNestedToolsSupport.Parameters>;
}

export type { harnessNestedToolsSupportTypes as default };
