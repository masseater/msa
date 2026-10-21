import type typesModule from "../types.types.ts";

declare namespace openaiCodexWsSocketTypes {
  interface WebSocketConnectRequest {
    readonly url: string;
    readonly headers: Headers;
    readonly signal: AbortSignal | undefined;
    readonly connectTimeoutMs: number | undefined;
    readonly env: typesModule.ProviderEnv | undefined;
  }
}

export type { openaiCodexWsSocketTypes as default };
