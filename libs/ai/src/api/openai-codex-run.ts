import { Effect } from "effect";

import type { Api, AssistantMessage, Model, TranscriptContext } from "../types.ts";
import { currentTimeMillis } from "../utils/clock.ts";
import { AssistantMessageEventStream } from "../utils/event-stream.ts";
import type { OpenAICodexResponsesOptions } from "./openai-codex-options.ts";
import { prepareCodexRun } from "./openai-codex-prepare.ts";
import { streamCodexOverSse } from "./openai-codex-sse-transport.ts";
import { type CodexStreamRun, failCodexOutput } from "./openai-codex-stream-run.ts";
import {
  isWebSocketSseFallbackActive,
  recordWebSocketSseFallback,
} from "./openai-codex-ws-stats.ts";
import { runWebSocketAttempt } from "./openai-codex-ws-stream.ts";

const websocketOutcome = (run: CodexStreamRun): Effect.Effect<"done" | "fallback" | "skipped"> => {
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

function pendingOutput(model: Model<"openai-codex-responses">): AssistantMessage {
  return {
    role: "assistant",
    content: [],
    api: "openai-codex-responses" as Api,
    provider: model.provider,
    model: model.id,
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: "pending",
    timestamp: currentTimeMillis(),
  };
}

export interface CodexStreamStart {
  readonly model: Model<"openai-codex-responses">;
  readonly context: TranscriptContext;
  readonly options: OpenAICodexResponsesOptions | undefined;
}

export function startCodexStream({
  model,
  context,
  options,
}: CodexStreamStart): AssistantMessageEventStream {
  const events = new AssistantMessageEventStream();
  const output = pendingOutput(model);
  Effect.runFork(
    runCodexStream({ model, context, output, events, options }).pipe(
      Effect.catchDefect((error) =>
        Effect.sync(() => failCodexOutput({ output, events, options })(error)),
      ),
    ),
  );
  return events;
}
