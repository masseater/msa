import type agentTypes from "@msa/agent-core/index.types";
import type compatTypes from "@msa/ai/compat.types";

import type agentSessionConfigTypes from "./agent-session-config.types.ts";
import type agentSessionEventTypes from "./agent-session-event.types.ts";
import type AgentSessionClass from "./agent-session.ts";
import type askTypes from "./ask.types.ts";
import type extensionsTypes from "./extensions/index.types.ts";

declare namespace agentSessionTypes {
  interface ParsedSkillBlock {
    name: string;
    location: string;
    content: string;
    userMessage: string | undefined;
  }

  type WithParentToolCallId<E> = agentSessionEventTypes.WithParentToolCallId<E>;

  type AgentSessionEvent = agentSessionEventTypes.AgentSessionEvent;

  type AgentSessionEventListener = agentSessionEventTypes.AgentSessionEventListener;

  type AgentSessionConfig = agentSessionConfigTypes.AgentSessionConfig;

  type ExtensionBindings = agentSessionConfigTypes.ExtensionBindings;

  type QueuedInputDisposition = "handled" | "queued";

  type PromptDisposition = QueuedInputDisposition | "started";

  interface PromptOptions {
    expandPromptTemplates?: boolean;
    images?: compatTypes.ImageContent[] | undefined;
    streamingBehavior?: "steer" | "followUp" | undefined;
    source?: extensionsTypes.InputSource;
    mode?: askTypes.PromptMode | undefined;
    preflightResult?: (disposition: PromptDisposition) => void;
  }

  interface ModelMutationOptions {
    persist?: boolean;
  }

  interface ModelCycleResult {
    model: compatTypes.Model<any>;
    thinkingLevel: agentTypes.ThinkingLevel;
    isScoped: boolean;
  }

  interface SessionStats {
    sessionFile: string | undefined;
    sessionId: string;
    userMessages: number;
    assistantMessages: number;
    toolCalls: number;
    toolResults: number;
    totalMessages: number;
    tokens: {
      input: number;
      output: number;
      cacheRead: number;
      cacheWrite: number;
      total: number;
    };
    cost: number;
    contextUsage?: extensionsTypes.ContextUsage | undefined;
  }

  type AgentSession = (typeof AgentSessionClass)["prototype"];
}

export type { agentSessionTypes as default };
