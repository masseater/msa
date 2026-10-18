import { Effect } from "effect";

import { encodeJsonSync } from "../utils/json-codec.ts";
import { processCodexEvents } from "./openai-codex-events.ts";
import { resolveCodexWebSocketUrl } from "./openai-codex-headers.ts";
import { type CodexStreamRun, finishCodexOutput } from "./openai-codex-stream-run.ts";
import { acquireWebSocket, type CachedWebSocketConnection } from "./openai-codex-ws-cache.ts";
import {
  collectWebSocketResponseItems,
  continuationRequestBody,
} from "./openai-codex-ws-continuation.ts";
import {
  handleWebSocketFailure,
  type WebSocketOutcome,
  type WebSocketRetries,
} from "./openai-codex-ws-failure.ts";
import { readCodexWebSocketEvents } from "./openai-codex-ws-inbox.ts";
import { recordWebSocketRequestStats } from "./openai-codex-ws-stats.ts";

function rememberContinuation(
  run: CodexStreamRun,
  entry: CachedWebSocketConnection | undefined,
): boolean {
  const { output, options, body } = run;
  if (options?.signal?.aborted === true) return false;
  if (entry !== undefined && output.responseId !== undefined && output.responseId !== "") {
    entry.continuation = {
      lastRequestBody: body,
      lastResponseId: output.responseId,
      lastResponseItems: collectWebSocketResponseItems(run),
    };
  }
  return true;
}

const streamOverWebSocket = Effect.fn("streamOverWebSocket")(function* (
  run: CodexStreamRun,
  onStart: () => void,
) {
  const { options, model } = run;
  const lease = yield* acquireWebSocket({
    url: resolveCodexWebSocketUrl(model.baseUrl),
    headers: run.websocketHeaders,
    signal: options?.signal,
    connectTimeoutMs: run.websocketConnectTimeoutMs,
    env: options?.env,
    sessionId: run.cacheSessionId,
    accountId: run.accountId,
  });
  const useCachedContext =
    options?.transport === "websocket-cached" || options?.transport === "auto";
  const entry = useCachedContext ? lease.entry : undefined;
  const requestBody = entry === undefined ? run.body : continuationRequestBody(entry)(run.body);
  const sessionId = run.cacheSessionId;
  recordWebSocketRequestStats({ sessionId, requestBody, reused: lease.reused, useCachedContext });
  let keep = true;
  const rawEvents = readCodexWebSocketEvents({
    socket: lease.socket,
    onListening: () =>
      lease.socket.send(encodeJsonSync({ type: "response.create", ...requestBody })),
    signal: options?.signal,
    idleTimeoutMs: run.httpTimeoutMs,
  });
  const forget = Effect.sync(() => {
    if (lease.entry !== undefined) lease.entry.continuation = undefined;
    keep = false;
  });
  yield* processCodexEvents(run)(rawEvents, onStart).pipe(
    Effect.andThen(Effect.sync(() => (keep = rememberContinuation(run, entry)))),
    Effect.catchDefect((error) => forget.pipe(Effect.andThen(Effect.die(error)))),
    Effect.ensuring(Effect.sync(() => lease.release({ keep }))),
  );
});

export function runWebSocketAttempt(
  run: CodexStreamRun,
): (retries: WebSocketRetries) => Effect.Effect<WebSocketOutcome> {
  return (retries) => {
    let started = false;
    const onStart = () => {
      started = true;
      run.emitStart();
    };
    return streamOverWebSocket(run, onStart).pipe(
      Effect.andThen(
        Effect.sync(() => {
          finishCodexOutput(run);
          return "done" as const;
        }),
      ),
      Effect.catchDefect((error) =>
        handleWebSocketFailure({ run, retries, started, error, retry: runWebSocketAttempt(run) }),
      ),
    );
  };
}
