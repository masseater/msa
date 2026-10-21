import type agentTypes from "@msa/agent-core/index.types";
import type compat from "@msa/ai/compat";
import type compatTypes from "@msa/ai/compat.types";

import type extensionsTypesTypes from "../src/core/extensions/types.types.ts";

declare namespace sessionKitTypes {
  interface ResponderInput {
    readonly context: compatTypes.TranscriptContext;
    readonly signal: AbortSignal | undefined;
    readonly stream: ReturnType<typeof compat.createAssistantMessageEventStream>;
  }

  type Responder = (input: ResponderInput) => void;

  type AgentTool = agentTypes.AgentTool;

  type StreamFn = agentTypes.StreamFn;

  type AssistantMessage = compatTypes.AssistantMessage;

  interface SessionOptions {
    readonly agentTools?: agentTypes.AgentTool[];
    readonly apiKey?: string | undefined;
    readonly cwd: string;
    readonly extensionFactories?: extensionsTypesTypes.ExtensionFactory[];
    readonly extensions?: extensionsTypesTypes.Extension[];
    readonly persistSession?: boolean;
    readonly streamFn: agentTypes.StreamFn;
    readonly systemPrompt?: string;
    readonly tools?: agentTypes.AgentTool[];
    readonly useTestKey?: boolean;
  }
}

export type { sessionKitTypes as default };
