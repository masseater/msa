import type { CreateAgentSessionOptions } from "../src/core/sdk.ts";

declare namespace defaultToolsSettingSupportTypes {
  type ToolOptions = Pick<
    CreateAgentSessionOptions,
    "tools" | "excludeTools" | "noTools" | "customTools"
  >;
}

export type { defaultToolsSettingSupportTypes as default };
