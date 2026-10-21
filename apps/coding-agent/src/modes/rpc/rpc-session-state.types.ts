import type agentTypes from "@msa/agent-core/index.types";
import type aiTypes from "@msa/ai/index.types";

import type contextBreakdownTypes from "../../core/context-breakdown.types.ts";
import type extensionsTypesTypes from "../../core/extensions/types.types.ts";
import type sourceInfoTypes from "../../core/source-info.types.ts";

declare namespace rpcSessionStateTypes {
  interface RpcSlashCommand {
    name: string;
    description?: string | undefined;
    source: "extension" | "prompt" | "skill";
    sourceInfo: sourceInfoTypes.SourceInfo;
  }

  interface RpcSessionState {
    model?: aiTypes.Model<any> | undefined;
    thinkingLevel: agentTypes.ThinkingLevel;
    isStreaming: boolean;
    isCompacting: boolean;
    steeringMode: "all" | "one-at-a-time";
    followUpMode: "all" | "one-at-a-time";
    sessionFile?: string | undefined;
    sessionId: string;
    sessionName?: string | undefined;
    autoCompactionEnabled: boolean;
    messageCount: number;
    pendingMessageCount: number;

    contextUsage?:
      | (extensionsTypesTypes.ContextUsage & { breakdown: contextBreakdownTypes.ContextBreakdown })
      | undefined;
  }
}

export type { rpcSessionStateTypes as default };
