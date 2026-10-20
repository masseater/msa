import { DateTime, Effect } from "effect";
import { Type } from "typebox";
import { describe, expect, it, vi } from "vite-plus/test";

import { stream as streamOpenAICodexResponses } from "../src/api/openai-codex-responses.ts";
import { getOpenAICodexWebSocketDebugStats } from "../src/api/openai-codex-ws-stats.ts";
import type { AssistantMessage, Context } from "../src/types.ts";
import { normalizeContext } from "../src/utils/transcript.ts";
import codexFakeWebSocket from "./codex-fake-websocket.ts";
import openaiCodexStreamSupport from "./openai-codex-stream-support.ts";

const { completedResponse, installFakeWebSocket } = codexFakeWebSocket;
const {
  codexModel,
  mockToken,
  promptContext,
  resetCodexStateAfterEach,
  runCodex,
  stubCodexFetch,
  usage,
} = openaiCodexStreamSupport;

const cached = (sessionId: string) => ({ sessionId, transport: "websocket-cached" as const });

const followUp = (first: Context, reply: AssistantMessage, extra: Context["messages"] = []) =>
  normalizeContext({
    ...first,
    messages: [
      ...first.messages,
      reply,
      ...extra,
      { content: "Now finish", role: "user", timestamp: 3 },
    ],
  });

const runWithTimers = (options: Parameters<typeof streamOpenAICodexResponses>[2]) =>
  Effect.gen(function* () {
    vi.useFakeTimers();
    const pending = streamOpenAICodexResponses(codexModel(), promptContext(), {
      apiKey: mockToken(),
      timeoutMs: 50,
      transport: "auto",
      ...options,
    }).result();
    yield* Effect.promise(() => vi.advanceTimersByTimeAsync(0));
    yield* Effect.promise(() => vi.advanceTimersByTimeAsync(50));
    return yield* Effect.promise(() => pending);
  });

const fallsBackWhenIdleBeforeFirstEvent = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const { fetchMock } = stubCodexFetch();
      const sockets = installFakeWebSocket({ reply: () => [] });
      const result = yield* runWithTimers({ sessionId: "ws-idle-before-start" });

      expect(sockets.sent).toHaveLength(1);
      expect(result.content.find((content) => content.type === "text")?.text).toBe("Hello");
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(getOpenAICodexWebSocketDebugStats("ws-idle-before-start")).toMatchObject({
        sseFallbacks: 1,
        websocketFailures: 1,
        websocketFallbackActive: true,
      });
    }),
  );

const errorsWhenIdleAfterStart = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const { fetchMock } = stubCodexFetch();
      installFakeWebSocket({
        reply: () => [
          {
            item: {
              content: [],
              id: "msg_1",
              role: "assistant",
              status: "in_progress",
              type: "message",
            },
            type: "response.output_item.added",
          },
        ],
      });
      const result = yield* runWithTimers({});

      expect(result.stopReason).toBe("error");
      expect(result.errorMessage).toBe("WebSocket idle timeout after 50ms");
      expect(fetchMock).not.toHaveBeenCalled();
    }),
  );

const reopensAgedConnection = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      vi.useFakeTimers();
      const startedAt = DateTime.toEpochMillis(DateTime.makeUnsafe("2026-07-03T00:00:00Z"));
      vi.setSystemTime(startedAt);
      const sockets = installFakeWebSocket({
        reply: (_sent, socket) => [completedResponse(`resp_${socket.id}`)],
      });
      const first = yield* runCodex(cached("aged-ws-session"));
      vi.setSystemTime(startedAt + 56 * 60 * 1000);
      yield* runCodex(cached("aged-ws-session"), { context: followUp(promptContext(), first) });

      expect(sockets.records.map((socket) => socket.sent.length)).toEqual([1, 1]);
      expect(getOpenAICodexWebSocketDebugStats("aged-ws-session")).toMatchObject({
        connectionsCreated: 2,
        connectionsReused: 0,
      });
    }),
  );

const customToolCall = (input: string) => ({
  call_id: "call_1",
  id: "ctc_1",
  input,
  name: "sample_tool",
  type: "custom_tool_call",
});

const toolTurnEvents = (responseId: string, withToolCall: boolean) => [
  { response: { id: responseId }, type: "response.created" },
  ...(withToolCall
    ? [
        { item: customToolCall(""), type: "response.output_item.added" },
        { delta: "abc", item_id: "ctc_1", type: "response.custom_tool_call_input.delta" },
        { input: "abc", item_id: "ctc_1", type: "response.custom_tool_call_input.done" },
        { item: customToolCall("abc"), type: "response.output_item.done" },
      ]
    : []),
  {
    response: { id: responseId, status: "completed", usage: usage(5, 3) },
    type: "response.completed",
  },
];

const grammarToolContext: Context = {
  messages: [{ content: "Use the tool", role: "user", timestamp: 1 }],
  systemPrompt: "You are a helpful assistant.",
  tools: [
    {
      constrainedSampling: { type: "grammar", variants: { openai_lark: "start: /[a-z]+/" } },
      description: "Sample tool",
      name: "sample_tool",
      parameters: Type.Object({ payload: Type.String() }),
    },
  ],
};

const deltaSessionStats = {
  cachedContextRequests: 2,
  connectionsCreated: 1,
  connectionsReused: 1,
  deltaRequests: 1,
  fullContextRequests: 1,
  lastDeltaInputItems: 2,
  lastPreviousResponseId: "resp_1",
  requests: 2,
  storeTrueRequests: 0,
};

const sendsOnlyInputDeltas = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const sockets = installFakeWebSocket({
        reply: (_sent, _socket, all) => toolTurnEvents(`resp_${all.length}`, all.length === 1),
      });
      const model = codexModel({ compat: { supportsOpenAIGrammarTools: true } });
      const first = yield* runCodex(cached("session-1"), {
        context: normalizeContext(grammarToolContext),
        model,
      });
      const toolResult = {
        content: [{ text: "real result", type: "text" as const }],
        isError: false,
        role: "toolResult" as const,
        timestamp: 2,
        toolCallId: "call_1|ctc_1",
        toolName: "sample_tool",
      };
      yield* runCodex(cached("session-1"), {
        context: followUp(grammarToolContext, first, [toolResult]),
        model,
      });

      expect(sockets.sent).toMatchObject([
        {
          input: [{ content: [{ text: "Use the tool", type: "input_text" }], role: "user" }],
          store: false,
        },
        {
          input: [
            { call_id: "call_1", output: "real result", type: "custom_tool_call_output" },
            { content: [{ text: "Now finish", type: "input_text" }], role: "user" },
          ],
          previous_response_id: "resp_1",
          store: false,
        },
      ]);
      expect(sockets.sent[0]).not.toHaveProperty("previous_response_id");
      expect(getOpenAICodexWebSocketDebugStats("session-1")).toMatchObject(deltaSessionStats);
    }),
  );

describe("openai-codex cached websocket sessions", () => {
  resetCodexStateAfterEach();

  it(
    "falls back to SSE when a websocket is idle before the first event",
    fallsBackWhenIdleBeforeFirstEvent,
  );
  it("errors when a websocket is idle after the stream started", errorsWhenIdleAfterStart);
  it(
    "opens a fresh cached websocket before the backend connection age limit",
    reopensAgedConnection,
  );
  it("sends only response input deltas in websocket-cached mode", sendsOnlyInputDeltas);
});
