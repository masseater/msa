import { Effect } from "effect";

import {
  appendAssistantMessageDiagnostic,
  createAssistantMessageDiagnostic,
} from "../utils/diagnostics.ts";
import {
  isCodexNonTransportError,
  isPreviousResponseNotFoundError,
  isWebSocketConnectionLimitReachedError,
} from "./openai-codex-error.ts";
import type { CodexStreamRun } from "./openai-codex-stream-run.ts";
import { recordWebSocketFailure, recordWebSocketSseFallback } from "./openai-codex-ws-stats.ts";

export type WebSocketOutcome = "done" | "fallback";

export interface WebSocketRetries {
  readonly connectionLimit: boolean;
  readonly missingContinuation: boolean;
}

export interface WebSocketFailure {
  readonly run: CodexStreamRun;
  readonly retries: WebSocketRetries;
  readonly started: boolean;
  readonly error: unknown;
  readonly retry: (retries: WebSocketRetries) => Effect.Effect<WebSocketOutcome>;
}

function recordTransportFailure({ run, started, error }: WebSocketFailure): void {
  appendAssistantMessageDiagnostic(
    run.output,
    createAssistantMessageDiagnostic("provider_transport_failure", error, {
      configuredTransport: run.transport,
      ...(started ? {} : { fallbackTransport: "sse" }),
      eventsEmitted: started,
      phase: started ? "after_message_stream_start" : "before_message_stream_start",
      requestBytes: new TextEncoder().encode(run.bodyJson).byteLength,
    }),
  );
  recordWebSocketFailure(run.cacheSessionId)(error);
}

export function handleWebSocketFailure(failure: WebSocketFailure): Effect.Effect<WebSocketOutcome> {
  const { run, retries, started, error, retry } = failure;
  const aborted = run.options?.signal?.aborted === true;
  const connectionLimitBeforeStart = !started && isWebSocketConnectionLimitReachedError(error);
  if (!aborted && isPreviousResponseNotFoundError(error) && !retries.missingContinuation) {
    return retry({ ...retries, missingContinuation: true });
  }
  if (!aborted && connectionLimitBeforeStart && !retries.connectionLimit) {
    return retry({ ...retries, connectionLimit: true });
  }
  if (aborted || (isCodexNonTransportError(error) && !connectionLimitBeforeStart)) {
    return Effect.die(error);
  }
  recordTransportFailure(failure);
  if (started) return Effect.die(error);
  recordWebSocketSseFallback(run.cacheSessionId);
  return Effect.succeed("fallback");
}
