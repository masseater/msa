import type { Fiber } from "effect";
import type { ResponseInput } from "openai/resources/responses/responses.js";

import type openaiCodexOptionsTypes from "./openai-codex-options.types.ts";
import type openaiCodexWsConstructorTypes from "./openai-codex-ws-constructor.types.ts";
import type openaiCodexWsSocketTypes from "./openai-codex-ws-socket.types.ts";

declare namespace openaiCodexWsCacheTypes {
  interface CachedWebSocketContinuationState {
    lastRequestBody: openaiCodexOptionsTypes.CodexRequestBody;
    lastResponseId: string;
    lastResponseItems: ResponseInput;
  }

  interface CachedWebSocketConnection {
    socket: openaiCodexWsConstructorTypes.WebSocketLike;
    busy: boolean;
    createdAt: number;
    idleTimer?: Fiber.Fiber<void> | undefined;
    continuation?: CachedWebSocketContinuationState | undefined;
  }

  interface SocketLease {
    readonly socket: openaiCodexWsConstructorTypes.WebSocketLike;
    readonly entry?: CachedWebSocketConnection;
    readonly reused: boolean;
    readonly release: (options?: { keep?: boolean }) => void;
  }

  interface WebSocketAcquireRequest extends openaiCodexWsSocketTypes.WebSocketConnectRequest {
    readonly sessionId: string | undefined;
    readonly accountId: string;
  }
}

export type { openaiCodexWsCacheTypes as default };
