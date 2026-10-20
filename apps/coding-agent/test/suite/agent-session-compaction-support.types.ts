import type aiTypes from "@msa/ai/index.types";

declare namespace agentSessionCompactionSupportTypes {
  type SessionWithCompactionInternals = {
    checkCompaction: (
      assistantMessage: aiTypes.AssistantMessage,
      skipAbortedCheck?: boolean,
    ) => Promise<boolean>;
    runAutoCompaction: (reason: "overflow" | "threshold", willRetry: boolean) => Promise<boolean>;
  };
}

export type { agentSessionCompactionSupportTypes as default };
