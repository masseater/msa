import { Effect } from "effect";

import diagnosticsModule from "../utils/diagnostics.ts";
import openaiCodexError from "./openai-codex-error.ts";
import type openaiCodexWsFailureTypes from "./openai-codex-ws-failure.types.ts";
import openaiCodexWsStats from "./openai-codex-ws-stats.ts";

const { appendAssistantMessageDiagnostic, createAssistantMessageDiagnostic } = diagnosticsModule;
const { recordWebSocketFailure, recordWebSocketSseFallback } = openaiCodexWsStats;
const {
  isCodexNonTransportError,
  isPreviousResponseNotFoundError,
  isWebSocketConnectionLimitReachedError,
} = openaiCodexError;

function recordTransportFailure({
  run,
  started,
  error,
}: openaiCodexWsFailureTypes.WebSocketFailure): void {
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

function handleWebSocketFailure(
  failure: openaiCodexWsFailureTypes.WebSocketFailure,
): Effect.Effect<openaiCodexWsFailureTypes.WebSocketOutcome> {
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

const openaiCodexWsFailure = {
  handleWebSocketFailure,
};

export default openaiCodexWsFailure;
