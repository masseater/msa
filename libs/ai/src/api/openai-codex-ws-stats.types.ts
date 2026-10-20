import type openaiCodexOptionsTypes from "./openai-codex-options.types.ts";

declare namespace openaiCodexWsStatsTypes {
  interface OpenAICodexWebSocketDebugStats {
    requests: number;
    connectionsCreated: number;
    connectionsReused: number;
    cachedContextRequests: number;
    storeTrueRequests: number;
    fullContextRequests: number;
    deltaRequests: number;
    lastInputItems: number;
    lastDeltaInputItems?: number | undefined;
    lastPreviousResponseId?: string | undefined;
    websocketFailures: number;
    sseFallbacks: number;
    websocketFallbackActive?: boolean;
    lastWebSocketError?: string;
  }

  interface WebSocketRequestRecord {
    readonly sessionId: string | undefined;
    readonly requestBody: openaiCodexOptionsTypes.CodexRequestBody;
    readonly reused: boolean;
    readonly useCachedContext: boolean;
  }
}

export type { openaiCodexWsStatsTypes as default };
