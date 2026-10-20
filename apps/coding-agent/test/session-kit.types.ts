import type agentTypes from "@msa/agent-core/index.types";
import type compat from "@msa/ai/compat";
import type compatTypes from "@msa/ai/compat.types";

import type { Extension, ExtensionFactory } from "../src/core/extensions/types.ts";

declare namespace sessionKitTypes {
  interface ResponderInput {
    readonly context: compatTypes.TranscriptContext;
    readonly signal: AbortSignal | undefined;
    readonly stream: ReturnType<typeof compat.createAssistantMessageEventStream>;
  }

  type Responder = (input: ResponderInput) => void;

  interface SessionOptions {
    readonly agentTools?: agentTypes.AgentTool[];
    readonly apiKey?: string | undefined;
    readonly cwd: string;
    readonly extensionFactories?: ExtensionFactory[];
    readonly extensions?: Extension[];
    readonly persistSession?: boolean;
    readonly streamFn: agentTypes.StreamFn;
    readonly systemPrompt?: string;
    readonly tools?: agentTypes.AgentTool[];
    readonly useTestKey?: boolean;
  }
}

export type { sessionKitTypes as default };
