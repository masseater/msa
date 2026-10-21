import type typesModule from "../../src/types.ts";

declare namespace calculateTypes {
  interface CalculateResult extends typesModule.AgentToolResult<undefined> {
    content: Array<{ type: "text"; text: string }>;
    details: undefined;
  }
}

export type { calculateTypes as default };
