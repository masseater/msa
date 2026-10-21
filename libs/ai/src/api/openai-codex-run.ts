import { Effect } from "effect";

import type typesModule from "../types.types.ts";
import type eventStreamTypes from "../utils/event-stream.types.ts";
import openaiCodexRunKit from "./openai-codex-run-kit.ts";
import type openaiCodexRunTypes from "./openai-codex-run.types.ts";
import openaiCodexSseTransport from "./openai-codex-sse-transport.ts";
import openaiCodexStreamRun from "./openai-codex-stream-run.ts";
import type openaiCodexStreamRunTypes from "./openai-codex-stream-run.types.ts";
import openaiCodexWsStats from "./openai-codex-ws-stats.ts";
import openaiCodexWsStream from "./openai-codex-ws-stream.ts";

const { clock, eventStream, openaiCodexPrepare } = openaiCodexRunKit;

const { isWebSocketSseFallbackActive, recordWebSocketSseFallback } = openaiCodexWsStats;
const { runWebSocketAttempt } = openaiCodexWsStream;
const { prepareCodexRun } = openaiCodexPrepare;
const { streamCodexOverSse } = openaiCodexSseTransport;
const { currentTimeMillis } = clock;
const { AssistantMessageEventStream } = eventStream;
const { failCodexOutput } = openaiCodexStreamRun;

const websocketOutcome = (
  run: openaiCodexStreamRunTypes.CodexStreamRun,
): Effect.Effect<"done" | "fallback" | "skipped"> => {
  if (run.transport === "sse") return Effect.succeed("skipped");
  if (isWebSocketSseFallbackActive(run.cacheSessionId)) {
    recordWebSocketSseFallback(run.cacheSessionId);
    return Effect.succeed("skipped");
  }
  return runWebSocketAttempt(run)({ connectionLimit: false, missingContinuation: false });
};

const runCodexStream = Effect.fn("runCodexStream")(function* (
  request: Parameters<typeof prepareCodexRun>[0],
) {
  const run = yield* prepareCodexRun(request);
  if ((yield* websocketOutcome(run)) === "done") return;
  yield* streamCodexOverSse(run);
});

function pendingOutput(
  model: typesModule.Model<"openai-codex-responses">,
): typesModule.AssistantMessage {
  return {
    api: "openai-codex-responses" as typesModule.Api,
    content: [],
    model: model.id,
    provider: model.provider,
    role: "assistant",
    stopReason: "pending",
    timestamp: currentTimeMillis(),
    usage: {
      cacheRead: 0,
      cacheWrite: 0,
      cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0, total: 0 },
      input: 0,
      output: 0,
      totalTokens: 0,
    },
  };
}

function startCodexStream({
  model,
  context,
  options,
}: openaiCodexRunTypes.CodexStreamStart): eventStreamTypes.AssistantMessageEventStream {
  const events = new AssistantMessageEventStream();
  const output = pendingOutput(model);
  Effect.runFork(
    runCodexStream({ context, events, model, options, output }).pipe(
      Effect.catchDefect((error) =>
        Effect.sync(() => failCodexOutput({ events, options, output })(error)),
      ),
    ),
  );
  return events;
}

const openaiCodexRun = {
  startCodexStream,
};

export default openaiCodexRun;
