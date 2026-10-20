import type { AgentToolResult } from "../../src/types.ts";

declare namespace calculateTypes {
  interface CalculateResult extends AgentToolResult<undefined> {
    content: Array<{ type: "text"; text: string }>;
    details: undefined;
  }
}

export type { calculateTypes as default };
