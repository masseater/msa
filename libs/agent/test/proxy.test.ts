import ai from "@msa/ai";
import type aiTypes from "@msa/ai/index.types";
import { Effect, Stream } from "effect";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import proxy from "../src/proxy.ts";
import type proxyTypes from "../src/proxy.types.ts";

const { normalizeContext } = ai;

const { streamProxy } = proxy;

const model: aiTypes.Model<"openai-responses"> = {
  api: "openai-responses",
  baseUrl: "https://api.openai.com/v1",
  contextWindow: 400000,
  cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0 },
  id: "gpt-5.4",
  input: ["text"],
  maxTokens: 128000,
  name: "GPT-5.4",
  provider: "openai",
  reasoning: true,
};

const usage: aiTypes.AssistantMessage["usage"] = {
  cacheRead: 0,
  cacheWrite: 0,
  cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0, total: 0 },
  input: 0,
  output: 0,
  totalTokens: 0,
};

afterEach(() => {
  vi.unstubAllGlobals();
});

const respondWith = (body: string): void => {
  vi.stubGlobal(
    "fetch",
    vi.fn(() => Promise.resolve(new Response(body, { status: 200 }))),
  );
};

const streamFromProxy = Effect.gen(function* () {
  const stream = streamProxy(model, normalizeContext({ messages: [], systemPrompt: "" }), {
    authToken: "test-token",
    proxyUrl: "https://proxy.example.com",
  });
  const events = yield* Stream.runCollect(
    Stream.fromAsyncIterable(stream, (error) => error as Error),
  ).pipe(Effect.orDie);
  const result = yield* Effect.promise(() => stream.result());
  return { events: [...events], result };
});

const toolCallEvents: proxyTypes.ProxyAssistantMessageEvent[] = [
  { type: "start" },
  { contentIndex: 0, id: "call_test|fc_test", toolName: "lookup", type: "toolcall_start" },
  { contentIndex: 0, delta: '{"value":"hello"}', type: "toolcall_delta" },
  {
    contentIndex: 0,
    toolCall: {
      arguments: { value: "hello" },
      id: "call_test|fc_test",
      name: "lookup",
      namespace: "dynamic_tools",
      type: "toolCall",
    },
    type: "toolcall_end",
  },
  { reason: "toolUse", type: "done", usage },
];

const sse = (event: object): string => `data: ${JSON.stringify(event)}`;

const keepsToolCallMetadata = Effect.gen(function* () {
  respondWith(toolCallEvents.map((event) => `${sse(event)}\n\n`).join(""));
  const { events, result } = yield* streamFromProxy;
  expect(events.find((event) => event.type === "toolcall_end")).toMatchObject({
    toolCall: { namespace: "dynamic_tools" },
    type: "toolcall_end",
  });
  expect(result.content[0]).toMatchObject({
    arguments: { value: "hello" },
    namespace: "dynamic_tools",
    type: "toolCall",
  });
});

const readsUnterminatedEvent = Effect.gen(function* () {
  respondWith(
    `${sse({ type: "start" })}\n\n${sse({ providerThinkingLevel: "high", reason: "stop", type: "done", usage })}`,
  );
  const { events, result } = yield* streamFromProxy;
  expect(events.map((event) => event.type)).toEqual(["start", "done"]);
  expect(result.stopReason).toBe("stop");
  expect(result.providerThinkingLevel).toBe("high");
});

const errorsWithoutTerminalEvent = Effect.gen(function* () {
  respondWith(`${sse({ type: "start" })}\n\n`);
  const { events, result } = yield* streamFromProxy;
  expect(events.map((event) => event.type)).toEqual(["start", "error"]);
  expect(result.stopReason).toBe("error");
  expect(result.errorMessage).toContain("Connection closed by proxy server");
});

const failsWith = (response: Response) =>
  Effect.gen(function* () {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(response)),
    );
    const { events, result } = yield* streamFromProxy;
    expect(events.map((event) => event.type)).toEqual(["error"]);
    expect(result.stopReason).toBe("error");
    return result.errorMessage;
  });

const reportsHttpErrors = Effect.gen(function* () {
  expect(
    yield* failsWith(new Response("oops", { status: 500, statusText: "Internal Server Error" })),
  ).toBe("Proxy error: 500 Internal Server Error");
  expect(
    yield* failsWith(
      new Response('{"error":"bad key"}', { status: 401, statusText: "Unauthorized" }),
    ),
  ).toBe("Proxy error: bad key");
});

describe("streamProxy", () => {
  it("reports the status line or the error field of a failed response", () =>
    Effect.runPromise(reportsHttpErrors));
  it("preserves tool-call metadata received only on toolcall_end", () =>
    Effect.runPromise(keepsToolCallMetadata));
  it("processes terminal metadata when the event is not newline-terminated", () =>
    Effect.runPromise(readsUnterminatedEvent));
  it("emits an error instead of hanging when the stream ends without a terminal event", () =>
    Effect.runPromise(errorsWithoutTerminalEvent));
});
