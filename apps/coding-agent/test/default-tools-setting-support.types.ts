import type sdkTypes from "../src/core/sdk.types.ts";

declare namespace defaultToolsSettingSupportTypes {
  type ToolOptions = Pick<
    sdkTypes.CreateAgentSessionOptions,
    "tools" | "excludeTools" | "noTools" | "customTools"
  >;
}

export type { defaultToolsSettingSupportTypes as default };
