import type typesModule from "../src/types.types.ts";

declare namespace probeInputTypes {
  type ReasoningLevel = "minimal" | "low" | "medium" | "high" | "xhigh" | "max";

  interface ProbeArgs {
    readonly maxTokens: number;
    readonly reasoning: ReasoningLevel;
    readonly sessionId: string;
    readonly transport: typesModule.Transport;
    readonly turns: number;
  }
}

export type { probeInputTypes as default };
