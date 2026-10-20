import { Effect } from "effect";
import { describe, expect, it, vi } from "vite-plus/test";

import {
  stream as streamOpenAICodexResponses,
  streamSimple as streamSimpleOpenAICodexResponses,
} from "../src/api/openai-codex-responses.ts";
import { getOpenAICodexWebSocketDebugStats } from "../src/api/openai-codex-ws-stats.ts";
import type { Api, Model } from "../src/types.ts";
import { normalizeContext } from "../src/utils/transcript.ts";
import codexFakeWebSocket from "./codex-fake-websocket.ts";
import openaiCodexStreamSupport from "./openai-codex-stream-support.ts";

const { completedResponse, installFakeWebSocket } = codexFakeWebSocket;
const {
  codexModel,
  helloEvents,
  mockToken,
  promptContext,
  resetCodexStateAfterEach,
  runCodex,
  stubCodexFetch,
  usage,
} = openaiCodexStreamSupport;

const forwardsAutoTransportEvents = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const { fetchMock } = stubCodexFetch();
      const sockets = installFakeWebSocket({
        reply: () =>
          helloEvents({
            response: { end_turn: false, status: "completed", usage: usage(5, 3) },
            type: "response.done",
          }),
      });
      const model = codexModel();
      const providerEvents: Array<{ event: unknown; model: Model<Api> }> = [];
      const result = yield* Effect.promise(() =>
        streamSimpleOpenAICodexResponses(model, promptContext(), {
          apiKey: mockToken(),
          onProviderStreamEvent: (event, eventModel) => {
            providerEvents.push({ event, model: eventModel });
          },
          sessionId: "session-auto",
          transport: "auto",
        }).result(),
      );

      expect(result.endTurn).toBe(false);
      expect(sockets.sent).toHaveLength(1);
      expect(providerEvents.map(({ event }) => (event as { type?: string }).type)).toEqual([
        "response.output_item.added",
        "response.content_part.added",
        "response.output_text.delta",
        "response.output_item.done",
        "response.done",
      ]);
      expect(providerEvents.every((entry) => entry.model === model)).toBe(true);
      const headers = sockets.records[0]?.headers;
      expect([
        headers?.["session-id"],
        headers?.["session_id"],
        headers?.["x-client-request-id"],
      ]).toEqual(["session-auto", undefined, "session-auto"]);
      expect(fetchMock).not.toHaveBeenCalled();
      expect(getOpenAICodexWebSocketDebugStats("session-auto")).toMatchObject({
        cachedContextRequests: 1,
        fullContextRequests: 1,
      });
    }),
  );

const scopesCachedSocketsToAccount = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const { fetchMock } = stubCodexFetch();
      const sockets = installFakeWebSocket({
        reply: (_sent, _socket, all) => [completedResponse(`resp_${all.length}`)],
      });
      const context = normalizeContext({ messages: [], systemPrompt: "" });
      yield* Effect.forEach(["account-a", "account-b", "account-a"], (account) =>
        runCodex(
          {
            apiKey: mockToken(account),
            sessionId: "shared-session",
            transport: "websocket-cached",
          },
          { context },
        ),
      );

      expect(sockets.records.map((socket) => socket.headers["chatgpt-account-id"])).toEqual([
        "account-a",
        "account-b",
      ]);
      expect(sockets.records.map((socket) => socket.headers["authorization"])).toEqual([
        `Bearer ${mockToken("account-a")}`,
        `Bearer ${mockToken("account-b")}`,
      ]);
      expect(fetchMock).not.toHaveBeenCalled();
      expect(getOpenAICodexWebSocketDebugStats("shared-session")).toMatchObject({
        connectionsCreated: 2,
        connectionsReused: 1,
      });
    }),
  );

const closesOneShotSockets = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const { fetchMock } = stubCodexFetch();
      const sockets = installFakeWebSocket({
        reply: (_sent, socket) => [completedResponse(`resp_${socket.id}`)],
      });
      const options = {
        cacheRetention: "none" as const,
        sessionId: "one-off-summary",
        transport: "auto" as const,
      };
      yield* runCodex(options);
      yield* runCodex(options);

      expect(sockets.records.map((socket) => socket.closed)).toEqual([true, true]);
      expect(sockets.sent.map((body) => body["prompt_cache_key"])).toEqual([undefined, undefined]);
      expect(getOpenAICodexWebSocketDebugStats("one-off-summary")).toBeUndefined();
      expect(fetchMock).not.toHaveBeenCalled();
    }),
  );

const fallsBackWhenConnectTimesOut = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      vi.useFakeTimers();
      const { fetchMock } = stubCodexFetch();
      installFakeWebSocket({ open: false });
      const pending = streamOpenAICodexResponses(codexModel(), promptContext(), {
        apiKey: mockToken(),
        sessionId: "ws-connect-timeout",
        timeoutMs: 300_000,
        transport: "auto",
        websocketConnectTimeoutMs: 50,
      }).result();
      yield* Effect.promise(() => vi.advanceTimersByTimeAsync(50));
      const result = yield* Effect.promise(() => pending);

      expect(result.content.find((content) => content.type === "text")?.text).toBe("Hello");
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(getOpenAICodexWebSocketDebugStats("ws-connect-timeout")).toMatchObject({
        lastWebSocketError: "WebSocket connect timeout after 50ms",
        sseFallbacks: 1,
        websocketFailures: 1,
        websocketFallbackActive: true,
      });
    }),
  );

const reconnectsAtConnectionLimit = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const { fetchMock } = stubCodexFetch();
      const sockets = installFakeWebSocket({
        reply: (_sent, socket) =>
          socket.id === 1
            ? [{ error: { code: "websocket_connection_limit_reached" }, type: "error" }]
            : [completedResponse("resp_1")],
      });
      const result = yield* runCodex(
        { transport: undefined },
        { context: normalizeContext({ messages: [], systemPrompt: "" }) },
      );

      expect(result.stopReason).toBe("stop");
      expect(sockets.records).toHaveLength(2);
      expect(fetchMock).not.toHaveBeenCalled();
    }),
  );

describe("openai-codex websocket transport", () => {
  resetCodexStateAfterEach();

  it(
    "forwards auto transport and raw provider events from streamSimple",
    forwardsAutoTransportEvents,
  );
  it("scopes cached websockets to the authenticated account", scopesCachedSocketsToAccount);
  it("closes one-shot websockets when cacheRetention is none", closesOneShotSockets);
  it(
    "falls back to SSE when websocket connect does not open before the connect timeout",
    fallsBackWhenConnectTimesOut,
  );
  it(
    "reconnects once when the websocket connection limit is reached before output starts",
    reconnectsAtConnectionLimit,
  );
});
