import type aiTypes from "@msa/ai/index.types";

import type proxyEventsTypes from "./proxy-events.types.ts";

declare namespace proxyTypes {
  type ProxySerializableStreamOptions = {
    [
      K in
        | "temperature"
        | "samplingParams"
        | "maxTokens"
        | "reasoning"
        | "cacheRetention"
        | "sessionId"
        | "headers"
        | "metadata"
        | "transport"
        | "thinkingBudgets"
        | "maxRetryDelayMs"
    ]?: aiTypes.SimpleStreamOptions[K] | undefined;
  };

  interface ProxyStreamOptions extends ProxySerializableStreamOptions {
    signal?: AbortSignal;

    authToken: string;

    proxyUrl: string;
  }

  type ProxyAssistantMessageEvent = proxyEventsTypes.ProxyAssistantMessageEvent;
}

export type { proxyTypes as default };
