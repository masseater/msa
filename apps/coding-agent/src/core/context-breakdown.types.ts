import type agentTypes from "@msa/agent-core/index.types";
import type aiTypes from "@msa/ai/index.types";

declare namespace contextBreakdownTypes {
  type ContextPart = "system" | "tools" | "conversation" | "toolResults" | "compaction" | "other";

  interface ContextBreakdownEntry {
    part: ContextPart;
    name: string;
    tokens: number;
  }

  interface ContextBreakdown {
    method: "exact" | "estimated";
    tokens: number;
    entries: ContextBreakdownEntry[];
  }

  interface ContextElement {
    part: ContextPart;
    name: string;
    estimate: number;
  }

  interface ContextBreakdownSource {
    messages: agentTypes.AgentMessage[];

    pending: agentTypes.AgentMessage[];
    transformContext:
      | ((messages: agentTypes.AgentMessage[]) => Promise<agentTypes.AgentMessage[]>)
      | undefined;
    convertToLlm: (
      messages: agentTypes.AgentMessage[],
    ) => aiTypes.Message[] | Promise<aiTypes.Message[]>;

    countTokens: (messages: aiTypes.Message[]) => Promise<number | undefined>;

    usageTokens: number | null;

    addingProvider: string | undefined;
  }
}

export type { contextBreakdownTypes as default };
