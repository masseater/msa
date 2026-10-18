import { Effect } from "effect";

import { combineAbortSignals } from "../utils/abort-signals.ts";
import { resolveCodexUrl } from "./openai-codex-headers.ts";
import type { CodexStreamRun } from "./openai-codex-stream-run.ts";

export interface CodexSseRequest {
  readonly run: CodexStreamRun;
  readonly body: Uint8Array<ArrayBuffer> | string;
  readonly maxRetries: number;
}

function headerTimeoutError(run: CodexStreamRun, signal: AbortSignal | undefined) {
  return (error: unknown): unknown =>
    signal?.aborted === true && !(run.options?.signal?.aborted ?? false)
      ? new Error(`Codex SSE response headers timed out after ${run.httpTimeoutMs}ms`, {
          cause: error,
        })
      : error;
}

export function fetchCodexSseResponse({ run, body }: CodexSseRequest): Effect.Effect<Response> {
  const timeoutMs = run.httpTimeoutMs;
  const headerTimeout =
    timeoutMs !== undefined && timeoutMs > 0 ? AbortSignal.timeout(timeoutMs) : undefined;
  const combined = combineAbortSignals([run.options?.signal, headerTimeout]);
  const fetch = run.options?.fetch ?? globalThis.fetch;
  const init = { method: "POST", headers: run.sseHeaders, body, signal: combined.signal ?? null };
  return Effect.promise(() => fetch(resolveCodexUrl(run.model.baseUrl), init)).pipe(
    Effect.catchDefect((error) => Effect.die(headerTimeoutError(run, headerTimeout)(error))),
    Effect.ensuring(Effect.sync(() => combined.cleanup())),
  );
}
