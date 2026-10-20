import type { Effect } from "effect";

import type openaiCodexStreamRunTypes from "./openai-codex-stream-run.types.ts";

declare namespace openaiCodexWsFailureTypes {
  type WebSocketOutcome = "done" | "fallback";

  interface WebSocketRetries {
    readonly connectionLimit: boolean;
    readonly missingContinuation: boolean;
  }

  interface WebSocketFailure {
    readonly run: openaiCodexStreamRunTypes.CodexStreamRun;
    readonly retries: WebSocketRetries;
    readonly started: boolean;
    readonly error: unknown;
    readonly retry: (retries: WebSocketRetries) => Effect.Effect<WebSocketOutcome>;
  }
}

export type { openaiCodexWsFailureTypes as default };
