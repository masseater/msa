import { type AssistantMessage, type Model, normalizeContext } from "@msa/ai";
import { Effect, Stream } from "effect";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { type ProxyAssistantMessageEvent, streamProxy } from "../src/proxy.ts";

const model: Model<"openai-responses"> = {
  id: "gpt-5.4",
  name: "GPT-5.4",
  api: "openai-responses",
  provider: "openai",
  baseUrl: "https://api.openai.com/v1",
  reasoning: true,
  input: ["text"],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 400000,
  maxTokens: 128000,
};

const usage: AssistantMessage["usage"] = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
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
  const stream = streamProxy(model, normalizeContext({ systemPrompt: "", messages: [] }), {
    authToken: "test-token",
    proxyUrl: "https://proxy.example.com",
  });
  const events = yield* Stream.runCollect(
    Stream.fromAsyncIterable(stream, (error) => error as Error),
  ).pipe(Effect.orDie);
  const result = yield* Effect.promise(() => stream.result());
  return { events: [...events], result };
});

const toolCallEvents: ProxyAssistantMessageEvent[] = [
  { type: "start" },
  { type: "toolcall_start", contentIndex: 0, id: "call_test|fc_test", toolName: "lookup" },
  { type: "toolcall_delta", contentIndex: 0, delta: '{"value":"hello"}' },
  {
    type: "toolcall_end",
    contentIndex: 0,
    toolCall: {
      type: "toolCall",
      id: "call_test|fc_test",
      name: "lookup",
      arguments: { value: "hello" },
      namespace: "dynamic_tools",
    },
  },
  { type: "done", reason: "toolUse", usage },
];

const sse = (event: object): string => `data: ${JSON.stringify(event)}`;

const keepsToolCallMetadata = Effect.gen(function* () {
  respondWith(toolCallEvents.map((event) => `${sse(event)}\n\n`).join(""));
  const { events, result } = yield* streamFromProxy;
  expect(events.find((event) => event.type === "toolcall_end")).toMatchObject({
    type: "toolcall_end",
    toolCall: { namespace: "dynamic_tools" },
  });
  expect(result.content[0]).toMatchObject({
    type: "toolCall",
    arguments: { value: "hello" },
    namespace: "dynamic_tools",
  });
});

const readsUnterminatedEvent = Effect.gen(function* () {
  respondWith(
    `${sse({ type: "start" })}\n\n${sse({ type: "done", reason: "stop", usage, providerThinkingLevel: "high" })}`,
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
