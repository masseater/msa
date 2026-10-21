import type openaiCodexWsConstructorTypes from "./openai-codex-ws-constructor.types.ts";

declare namespace openaiCodexWsInboxTypes {
  interface CodexWebSocketReader {
    readonly socket: openaiCodexWsConstructorTypes.WebSocketLike;
    readonly onListening: () => void;
    readonly signal: AbortSignal | undefined;
    readonly idleTimeoutMs: number | undefined;
  }
}

export type { openaiCodexWsInboxTypes as default };
