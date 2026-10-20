import type { AgentTool, StreamFn } from "@msa/agent-core";
import type { TranscriptContext, createAssistantMessageEventStream } from "@msa/ai/compat";

import type { Extension, ExtensionFactory } from "../src/core/extensions/types.ts";

declare namespace sessionKitTypes {
  interface ResponderInput {
    readonly context: TranscriptContext;
    readonly signal: AbortSignal | undefined;
    readonly stream: ReturnType<typeof createAssistantMessageEventStream>;
  }

  type Responder = (input: ResponderInput) => void;

  interface SessionOptions {
    readonly agentTools?: AgentTool[];
    readonly apiKey?: string | undefined;
    readonly cwd: string;
    readonly extensionFactories?: ExtensionFactory[];
    readonly extensions?: Extension[];
    readonly persistSession?: boolean;
    readonly streamFn: StreamFn;
    readonly systemPrompt?: string;
    readonly tools?: AgentTool[];
    readonly useTestKey?: boolean;
  }
}

export type { sessionKitTypes as default };
