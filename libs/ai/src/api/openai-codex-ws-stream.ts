import { Effect } from "effect";

import type openaiCodexStreamRunTypes from "./openai-codex-stream-run.types.ts";
import openaiCodexWsCache from "./openai-codex-ws-cache.ts";
import type openaiCodexWsCacheTypes from "./openai-codex-ws-cache.types.ts";
import openaiCodexWsContinuation from "./openai-codex-ws-continuation.ts";
import openaiCodexWsFailure from "./openai-codex-ws-failure.ts";
import type openaiCodexWsFailureTypes from "./openai-codex-ws-failure.types.ts";
import openaiCodexWsInbox from "./openai-codex-ws-inbox.ts";
import openaiCodexWsStats from "./openai-codex-ws-stats.ts";
import openaiCodexWsStreamKit from "./openai-codex-ws-stream-kit.ts";

const { jsonCodec, openaiCodexEvents, openaiCodexHeaders, openaiCodexStreamRun } =
  openaiCodexWsStreamKit;

const { collectWebSocketResponseItems, continuationRequestBody } = openaiCodexWsContinuation;
const { acquireWebSocket } = openaiCodexWsCache;
const { resolveCodexWebSocketUrl } = openaiCodexHeaders;
const { recordWebSocketRequestStats } = openaiCodexWsStats;
const { readCodexWebSocketEvents } = openaiCodexWsInbox;
const { encodeJsonSync } = jsonCodec;
const { processCodexEvents } = openaiCodexEvents;
const { finishCodexOutput } = openaiCodexStreamRun;
const { handleWebSocketFailure } = openaiCodexWsFailure;

function rememberContinuation(
  run: openaiCodexStreamRunTypes.CodexStreamRun,
  entry: openaiCodexWsCacheTypes.CachedWebSocketConnection | undefined,
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
  run: openaiCodexStreamRunTypes.CodexStreamRun,
  onStart: () => void,
) {
  const { options, model } = run;
  const lease = yield* acquireWebSocket({
    accountId: run.accountId,
    connectTimeoutMs: run.websocketConnectTimeoutMs,
    env: options?.env,
    headers: run.websocketHeaders,
    sessionId: run.cacheSessionId,
    signal: options?.signal,
    url: resolveCodexWebSocketUrl(model.baseUrl),
  });
  const useCachedContext =
    options?.transport === "websocket-cached" || options?.transport === "auto";
  const entry = useCachedContext ? lease.entry : undefined;
  const requestBody = entry === undefined ? run.body : continuationRequestBody(entry)(run.body);
  const sessionId = run.cacheSessionId;
  recordWebSocketRequestStats({ requestBody, reused: lease.reused, sessionId, useCachedContext });
  let keep = true;
  const rawEvents = readCodexWebSocketEvents({
    idleTimeoutMs: run.httpTimeoutMs,
    onListening: () =>
      lease.socket.send(encodeJsonSync({ type: "response.create", ...requestBody })),
    signal: options?.signal,
    socket: lease.socket,
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

function runWebSocketAttempt(
  run: openaiCodexStreamRunTypes.CodexStreamRun,
): (
  retries: openaiCodexWsFailureTypes.WebSocketRetries,
) => Effect.Effect<openaiCodexWsFailureTypes.WebSocketOutcome> {
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
        handleWebSocketFailure({ error, retries, retry: runWebSocketAttempt(run), run, started }),
      ),
    );
  };
}

const openaiCodexWsStream = {
  runWebSocketAttempt,
};

export default openaiCodexWsStream;
