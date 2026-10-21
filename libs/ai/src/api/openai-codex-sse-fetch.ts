import { Effect } from "effect";

import abortSignals from "../utils/abort-signals.ts";
import openaiCodexHeaders from "./openai-codex-headers.ts";
import type openaiCodexSseFetchTypes from "./openai-codex-sse-fetch.types.ts";
import type openaiCodexStreamRunTypes from "./openai-codex-stream-run.types.ts";

const { combineAbortSignals } = abortSignals;
const { resolveCodexUrl } = openaiCodexHeaders;

function headerTimeoutError(
  run: openaiCodexStreamRunTypes.CodexStreamRun,
  signal: AbortSignal | undefined,
) {
  return (error: unknown): unknown =>
    signal?.aborted === true && !(run.options?.signal?.aborted ?? false)
      ? new Error(`Codex SSE response headers timed out after ${run.httpTimeoutMs}ms`, {
          cause: error,
        })
      : error;
}

function fetchCodexSseResponse({
  run,
  body,
}: openaiCodexSseFetchTypes.CodexSseRequest): Effect.Effect<Response> {
  const timeoutMs = run.httpTimeoutMs;
  const headerTimeout =
    timeoutMs !== undefined && timeoutMs > 0 ? AbortSignal.timeout(timeoutMs) : undefined;
  const combined = combineAbortSignals([run.options?.signal, headerTimeout]);
  const fetch = run.options?.fetch ?? globalThis.fetch;
  const init = { body, headers: run.sseHeaders, method: "POST", signal: combined.signal ?? null };
  return Effect.promise(() => fetch(resolveCodexUrl(run.model.baseUrl), init)).pipe(
    Effect.catchDefect((error) => Effect.die(headerTimeoutError(run, headerTimeout)(error))),
    Effect.ensuring(Effect.sync(() => combined.cleanup())),
  );
}

const openaiCodexSseFetch = {
  fetchCodexSseResponse,
};

export default openaiCodexSseFetch;
