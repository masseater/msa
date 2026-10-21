import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import { Clock, Console, Effect } from "effect";

import openaiCodexResponses from "../src/api/openai-codex-responses.ts";
import openaiCodexWsCache from "../src/api/openai-codex-ws-cache.ts";
import openaiCodexWsStats from "../src/api/openai-codex-ws-stats.ts";
import compat from "../src/compat.ts";
import type typesModule from "../src/types.types.ts";
import probeInput from "./codex-websocket-cached-probe-input.ts";
import modelChoice from "./model-choice.ts";
import resolveApiKey from "./oauth.ts";

const { stream: streamOpenAICodexResponses } = openaiCodexResponses;
const { getOpenAICodexWebSocketDebugStats, resetOpenAICodexWebSocketDebugStats } =
  openaiCodexWsStats;
const { closeOpenAICodexWebSocketSessions } = openaiCodexWsCache;
const { normalizeContext } = compat;

const { chooseModel } = modelChoice;
const { buildPrompt, probeTool, readArgs } = probeInput;

type ProbeArgs = ReturnType<typeof readArgs>;

const toolCallsOf = (message: typesModule.AssistantMessage) =>
  message.content.filter((block): block is typesModule.ToolCall => block.type === "toolCall");

const answerTool = (call: typesModule.ToolCall, timestamp: number) => ({
  content: [
    {
      text: `deterministic_probe_result turn=${String(call.arguments["turn"])} fixed=OK`,
      type: "text" as const,
    },
  ],
  details: { fixed: "OK" },
  isError: false,
  role: "toolResult" as const,
  timestamp,
  toolCallId: call.id,
  toolName: call.name,
});

interface Probe {
  readonly apiKey: string;
  readonly args: ProbeArgs;
  readonly context: typesModule.TranscriptContext;
  readonly model: typesModule.Model<"openai-codex-responses">;
}

const requestOnce = (probe: Probe, turn: number, request: number) =>
  Effect.gen(function* () {
    const message = yield* Effect.promise(() =>
      streamOpenAICodexResponses(probe.model, probe.context, {
        apiKey: probe.apiKey,
        maxTokens: probe.args.maxTokens,
        reasoningEffort: probe.args.reasoning,
        sessionId: probe.args.sessionId,
        transport: probe.args.transport,
      }).result(),
    );
    probe.context.messages.push(message);
    const { usage } = message;
    yield* Console.log(
      `turn ${turn}.${request} | stop ${message.stopReason} | in ${usage.input} | out ${usage.output} | cache ${usage.cacheRead}/${usage.cacheWrite} | tools ${toolCallsOf(message).length}`,
    );
    if (message.stopReason === "error" || message.stopReason === "aborted") {
      return yield* Effect.die(
        new Error(message.errorMessage ?? `request failed on turn ${turn}.${request}`),
      );
    }
    return message;
  });

const runTurn = (probe: Probe, turn: number) =>
  Effect.gen(function* () {
    probe.context.messages.push({
      content: buildPrompt(turn),
      role: "user",
      timestamp: yield* Clock.currentTimeMillis,
    });
    const started = yield* Clock.currentTimeMillis;
    const answerUntilDone = (request: number): Effect.Effect<typesModule.AssistantMessage> =>
      Effect.gen(function* () {
        if (request > 5) return yield* Effect.die(new Error(`Too many requests for turn ${turn}`));
        const message = yield* requestOnce(probe, turn, request);
        const calls = toolCallsOf(message);
        if (calls.length === 0) return message;
        const timestamp = yield* Clock.currentTimeMillis;
        probe.context.messages.push(...calls.map((call) => answerTool(call, timestamp)));
        return yield* answerUntilDone(request + 1);
      });
    yield* answerUntilDone(1);
    return (yield* Clock.currentTimeMillis) - started;
  });

const percentile = (values: readonly number[], p: number) =>
  values.toSorted((a, b) => a - b)[Math.max(0, Math.ceil((p / 100) * values.length) - 1)] ?? 0;

const summarize = (args: ProbeArgs, elapsed: readonly number[]) =>
  Effect.gen(function* () {
    const seconds = (ms: number) => `${(ms / 1000).toFixed(2)}s`;
    const total = elapsed.reduce((sum, value) => sum + value, 0);
    yield* Console.log(
      `timing | turns ${elapsed.length} | total ${seconds(total)} | avg ${seconds(total / Math.max(1, elapsed.length))} | p50 ${seconds(percentile(elapsed, 50))} | p95 ${seconds(percentile(elapsed, 95))}`,
    );
    const stats = getOpenAICodexWebSocketDebugStats(args.sessionId);
    yield* Console.log(
      stats === undefined
        ? `transport summary | requested ${args.transport} | observed sse/no-websocket`
        : `transport summary | requested ${args.transport} | storeTrue ${stats.storeTrueRequests}/${stats.requests} | full/delta ${stats.fullContextRequests}/${stats.deltaRequests} | connections ${stats.connectionsCreated}/${stats.connectionsReused}`,
    );
    closeOpenAICodexWebSocketSessions(args.sessionId);
  });

const program = Effect.gen(function* () {
  const args = readArgs(yield* Clock.currentTimeMillis);
  const codex = chooseModel(
    "openai-codex",
    "Codex Responses",
    (model) => model.api === "openai-codex-responses",
  );
  const apiKey = yield* Effect.promise(() => resolveApiKey("openai-codex"));
  if (apiKey === undefined || apiKey === "") {
    return yield* Effect.die(new Error("No stored OpenAI Codex credential was found."));
  }
  const probe: Probe = {
    apiKey,
    args,
    context: normalizeContext({
      messages: [],
      systemPrompt:
        "You are participating in a benchmark. For each benchmark turn, call deterministic_probe exactly once before the final answer. Keep final answers minimal.",
      tools: [probeTool],
    }),
    model: { ...(codex as typesModule.Model<"openai-codex-responses">), maxTokens: args.maxTokens },
  };
  resetOpenAICodexWebSocketDebugStats(args.sessionId);
  yield* Console.log(
    `model ${codex.id} | session ${args.sessionId} | turns ${args.turns} | transport ${args.transport}`,
  );
  const elapsed = yield* Effect.forEach(
    Array.from({ length: args.turns }, (_, index) => index + 1),
    (turn) => runTurn(probe, turn),
  );
  yield* summarize(args, elapsed);
});

NodeRuntime.runMain(program);
