import type agentTypes from "@msa/agent-core/index.types";
import type compatTypes from "@msa/ai/compat.types";
import type aiTypes from "@msa/ai/index.types";

declare namespace compactionSummaryTypes {
  type SummaryRest = [
    model: compatTypes.Model<any>,
    reserveTokens: number,
    apiKey: string | undefined,
    headers?: Record<string, string>,
    signal?: AbortSignal,
    customInstructions?: string,
    previousSummary?: string,
    thinkingLevel?: agentTypes.ThinkingLevel,
    streamFn?: agentTypes.StreamFn,
    env?: Record<string, string>,
    retry?: aiTypes.RetryPolicy,
    callbacks?: aiTypes.RetryCallbacks,
    sessionId?: string,
  ];

  interface TurnPrefixInput {
    messages: agentTypes.AgentMessage[];
    model: compatTypes.Model<any>;
    reserveTokens: number;
    apiKey: string | undefined;
    headers: Record<string, string> | undefined;
    env: Record<string, string> | undefined;
    signal: AbortSignal | undefined;
    thinkingLevel: agentTypes.ThinkingLevel | undefined;
    streamFn: agentTypes.StreamFn | undefined;
    retry: aiTypes.RetryPolicy | undefined;
    callbacks: aiTypes.RetryCallbacks | undefined;
    sessionId: string | undefined;
  }
}

export type { compactionSummaryTypes as default };
