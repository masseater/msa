import type { AssistantMessage } from "@msa/ai";

declare namespace agentSessionCompactionSupportTypes {
  type SessionWithCompactionInternals = {
    checkCompaction: (
      assistantMessage: AssistantMessage,
      skipAbortedCheck?: boolean,
    ) => Promise<boolean>;
    runAutoCompaction: (reason: "overflow" | "threshold", willRetry: boolean) => Promise<boolean>;
  };
}

export type { agentSessionCompactionSupportTypes as default };
