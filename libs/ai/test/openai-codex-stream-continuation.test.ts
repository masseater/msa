import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";

import openaiCodexResponses from "../src/api/openai-codex-responses.ts";
import openaiCodexWsStats from "../src/api/openai-codex-ws-stats.ts";
import transcript from "../src/utils/transcript.ts";
import codexFakeWebSocket from "./codex-fake-websocket.ts";
import openaiCodexStreamSupport from "./openai-codex-stream-support.ts";

const { normalizeContext } = transcript;
const { stream: streamOpenAICodexResponses } = openaiCodexResponses;
const { getOpenAICodexWebSocketDebugStats } = openaiCodexWsStats;

const { installFakeWebSocket } = codexFakeWebSocket;
const {
  codexModel,
  collectEvents,
  mockToken,
  promptContext,
  resetCodexStateAfterEach,
  runCodex,
  stubCodexFetch,
} = openaiCodexStreamSupport;

const answer = (responseId: string, messageId: string, text: string) => {
  const message = (status: string, content: object[]) => ({
    content,
    id: messageId,
    role: "assistant",
    status,
    type: "message",
  });
  return [
    { response: { id: responseId }, type: "response.created" },
    { item: message("in_progress", []), output_index: 0, type: "response.output_item.added" },
    {
      item: message("completed", [{ text, type: "output_text" }]),
      output_index: 0,
      type: "response.output_item.done",
    },
    {
      response: {
        id: responseId,
        status: "completed",
        usage: { input_tokens: 5, output_tokens: 3, total_tokens: 8 },
      },
      type: "response.completed",
    },
  ];
};

const missingPreviousResponse = [
  {
    plan_type: "plus",
    rate_limits: { allowed: true, limit_reached: false },
    type: "codex.rate_limits",
  },
  {
    error: {
      code: "previous_response_not_found",
      message: "Previous response with id 'resp_1' not found.",
      param: "previous_response_id",
    },
    status: 400,
    type: "error",
  },
];

const scriptRecovery = (recoveryTransport: "sse" | "websocket") =>
  installFakeWebSocket({
    reply: (_sent, _socket, all) => {
      if (all.length === 1) return answer("resp_1", "msg_1", "Hello");
      if (all.length === 2) return missingPreviousResponse;
      return recoveryTransport === "sse" ? "error" : answer("resp_2", "msg_2", "Recovered");
    },
  });

const recoveredStats = (recoveryTransport: "sse" | "websocket") => ({
  connectionsCreated: 2,
  connectionsReused: 1,
  deltaRequests: 1,
  fullContextRequests: 2,
  requests: 3,
  sseFallbacks: recoveryTransport === "sse" ? 1 : 0,
  websocketFailures: recoveryTransport === "sse" ? 1 : 0,
});

const recoversMissingContinuation = (recoveryTransport: "sse" | "websocket") =>
  Effect.runPromise(
    Effect.gen(function* () {
      const sessionId = `missing-continuation-${recoveryTransport}`;
      const options = { apiKey: mockToken(), sessionId, transport: "websocket-cached" as const };
      const { fetchMock } = stubCodexFetch();
      const sockets = scriptRecovery(recoveryTransport);
      const first = yield* runCodex(options);
      const secondContext = normalizeContext({
        messages: [
          ...promptContext().messages,
          first,
          { content: "Now finish", role: "user", timestamp: 2 },
        ],
      });
      const { events, result } = yield* collectEvents(
        streamOpenAICodexResponses(codexModel(), secondContext, options),
      );

      expect(result.stopReason).toBe("stop");
      expect(result.content.find((content) => content.type === "text")?.text).toBe(
        recoveryTransport === "sse" ? "Hello" : "Recovered",
      );
      expect(events.filter((event) => event.type === "start")).toHaveLength(1);
      expect(events.some((event) => event.type === "error")).toBe(false);
      expect(sockets.records.map((socket) => socket.sent.length)).toEqual([2, 1]);
      const [, retried, rebuilt] = sockets.sent;
      expect(retried).toMatchObject({
        input: [{ content: [{ text: "Now finish", type: "input_text" }], role: "user" }],
        previous_response_id: "resp_1",
      });
      expect(rebuilt).not.toHaveProperty("previous_response_id");
      const rebuiltInput = (rebuilt?.["input"] ?? []) as unknown[];
      expect(rebuiltInput).toHaveLength(3);
      expect(rebuiltInput.at(-1)).toEqual({
        content: [{ text: "Now finish", type: "input_text" }],
        role: "user",
      });
      expect(fetchMock).toHaveBeenCalledTimes(recoveryTransport === "sse" ? 1 : 0);
      expect(getOpenAICodexWebSocketDebugStats(sessionId)).toMatchObject(
        recoveredStats(recoveryTransport),
      );
    }),
  );

describe("openai-codex cached websocket continuation", () => {
  resetCodexStateAfterEach();

  it.for(["websocket", "sse"] as const)(
    "recovers a missing cached websocket continuation via %s",
    recoversMissingContinuation,
  );
});
