import type { Transport } from "../src/types.ts";

declare namespace probeInputTypes {
  type ReasoningLevel = "minimal" | "low" | "medium" | "high" | "xhigh" | "max";

  interface ProbeArgs {
    readonly maxTokens: number;
    readonly reasoning: ReasoningLevel;
    readonly sessionId: string;
    readonly transport: Transport;
    readonly turns: number;
  }
}

export type { probeInputTypes as default };
