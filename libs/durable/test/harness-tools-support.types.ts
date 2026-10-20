import type { ToolRegistration } from "@msa/durable";

import type harnessToolsSupport from "./harness-tools-support.ts";

declare namespace harnessToolsSupportTypes {
  type Echo = ToolRegistration<typeof harnessToolsSupport.EchoParameters>;

  type Execute = Echo["execute"];
}

export type { harnessToolsSupportTypes as default };
