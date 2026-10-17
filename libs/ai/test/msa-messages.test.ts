import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

import { Effect, Stream } from "effect";
import { afterEach, describe, expect, it } from "vite-plus/test";

import { type MsaMessagesOptions, stream, streamSimple } from "../src/api/msa-messages.ts";
import type { Api, AssistantMessageEvent, Context, Model, StopReason } from "../src/types.ts";
import { currentTimeMillis } from "../src/utils/clock.ts";
import { normalizeContext } from "../src/utils/transcript.ts";
import { encodeJson } from "./json-codec.ts";

type RecordedRequest = {
  url: string;
  headers: IncomingMessage["headers"];
  body: unknown;
};

type ResponderOptions = {
  status?: number;
  headers?: Record<string, string>;
  events?: unknown[];
  rawBody?: string;
};

let server: Server | undefined;

afterEach(() => {
  server?.close();
  server = undefined;
});

const startServerFirst = (options: ResponderOptions) =>
  Effect.sync(() => {
    const requests: RecordedRequest[] = [];

    server = createServer((request: IncomingMessage, response: ServerResponse) => {
      const chunks: Buffer[] = [];
      request.on("data", (chunk: Buffer) => chunks.push(chunk));
      request.on("end", () => {
        const raw = Buffer.concat(chunks).toString("utf-8");
        requests.push({
          url: request.url ?? "",
          headers: request.headers,
          body: raw === "" ? undefined : JSON.parse(raw),
        });

        if (
          options.status !== undefined &&
          options.status !== 0 &&
          !Number.isNaN(options.status) &&
          options.status !== 200
        ) {
          response.statusCode = options.status;
          response.setHeader("content-type", "application/json");
          response.end(options.rawBody ?? "{}");
          return;
        }

        response.statusCode = 200;
        response.setHeader("content-type", "text/event-stream");
        for (const [name, value] of Object.entries(options.headers ?? {})) {
          response.setHeader(name, value);
        }
        for (const event of options.events ?? []) {
          response.write(`data: ${JSON.stringify(event)}\n\n`);
        }
        response.end();
      });
    });
    return { requests };
  });

const startServerRest = Effect.fn("startServerRest")(function* ({
  requests,
}: Effect.Success<ReturnType<typeof startServerFirst>>) {
  yield* Effect.promise(
    () =>
      new Promise<void>((resolve) => {
        server!.listen(0, "127.0.0.1", () => resolve());
      }),
  );

  const address = server!.address() as AddressInfo;
  return { baseUrl: `http://127.0.0.1:${address.port}/v1`, requests };
});

function startServer(
  options: ResponderOptions,
): Promise<{ baseUrl: string; requests: RecordedRequest[] }> {
  return Effect.runPromise(
    Effect.gen(function* () {
      const { requests } = yield* startServerFirst(options);
      return yield* startServerRest({ requests });
    }),
  );
}

function createModel(baseUrl: string): Model<"msa-messages"> {
  return {
    id: "auto",
    name: "Radius Auto",
    api: "msa-messages",
    provider: "radius",
    baseUrl,
    reasoning: false,
    input: ["text"],
    cost: { input: 1, output: 2, cacheRead: 0.1, cacheWrite: 0.2 },
    contextWindow: 128000,
    maxTokens: 16384,
  };
}

const context: Context = {
  messages: [{ role: "user", content: "Hello", timestamp: currentTimeMillis() }],
};

const usage = {
  input: 10,
  output: 5,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 15,
  cost: { input: 0.1, output: 0.2, cacheRead: 0, cacheWrite: 0, total: 0.3 },
};

describe("msa-messages", () => {
  it("streams text and tool calls and resolves the terminal message", async () => {
    const { baseUrl, requests } = await startServer({
      events: [
        { type: "start" },
        { type: "text_start", contentIndex: 0 },
        { type: "text_delta", contentIndex: 0, delta: "Hel" },
        { type: "text_delta", contentIndex: 0, delta: "lo" },
        { type: "text_end", contentIndex: 0, content: "Hello" },
        { type: "toolcall_start", contentIndex: 1, id: "call_1", toolName: "read" },
        { type: "toolcall_delta", contentIndex: 1, delta: '{"path":' },
        { type: "toolcall_delta", contentIndex: 1, delta: '"a.txt"}' },
        {
          type: "toolcall_end",
          contentIndex: 1,
          toolCall: { type: "toolCall", id: "call_1", name: "read", arguments: { path: "a.txt" } },
        },
        {
          type: "done",
          reason: "toolUse",
          usage,
          responseId: "resp_1",
          providerThinkingLevel: "high",
        },
      ],
    });
    const model = createModel(baseUrl);

    const events: AssistantMessageEvent[] = [];
    const partialStopReasons: StopReason[] = [];
    const eventStream = stream(model, normalizeContext(context), {
      apiKey: "test-key",
      sessionId: "session-1",
      toolChoice: "auto",
      maxTokens: 100,
      headers: { "x-custom": "1" },
    });
    await Effect.runPromise(
      Stream.fromAsyncIterable(eventStream, (error) => error).pipe(
        Stream.orDie,
        Stream.runForEach((event) =>
          Effect.sync(() => {
            if ("partial" in event) {
              partialStopReasons.push(event.partial.stopReason);
            }
            events.push(event);
          }),
        ),
      ),
    );
    const message = await eventStream.result();

    expect(partialStopReasons[0]).toBe("pending");
    expect(message.stopReason).toBe("toolUse");
    expect(message.usage).toEqual(usage);
    expect(message.responseId).toBe("resp_1");
    expect(message.providerThinkingLevel).toBe("high");
    expect(message.model).toBe("auto");
    expect(message.provider).toBe("radius");
    expect(message.content).toEqual([
      { type: "text", text: "Hello", textSignature: undefined },
      { type: "toolCall", id: "call_1", name: "read", arguments: { path: "a.txt" } },
    ]);
    expect(events.some((event) => event.type === "text_delta")).toBe(true);
    expect(events.filter((event) => event.type === "toolcall_end")).toHaveLength(1);

    expect(requests).toHaveLength(1);
    const request = requests[0];
    expect(request?.url).toBe("/v1/messages");
    expect(request?.headers.authorization).toBe("Bearer test-key");
    expect(request?.headers["x-custom"]).toBe("1");
    expect(request?.body).toEqual({
      model: "auto",
      context,
      options: { maxTokens: 100, sessionId: "session-1", toolChoice: "auto" },
    });
  });
});

describe("msa-messages", () => {
  it("forwards parsed wire events in order before converting them", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const effectContext = yield* Effect.context();
        const wireEvents = [
          { type: "start" },
          { type: "text_start", contentIndex: 0 },
          { type: "text_delta", contentIndex: 0, delta: "Hello", gatewayField: "upstream-value" },
          { type: "text_end", contentIndex: 0, content: "Hello" },
          { type: "done", reason: "stop", usage, responseId: "resp_1" },
        ];
        const { baseUrl } = yield* Effect.promise(() => startServer({ events: wireEvents }));
        const model = createModel(baseUrl);
        const received: unknown[] = [];
        const eventModels: Model<Api>[] = [];
        const message = yield* Effect.promise(() =>
          streamSimple(model, normalizeContext(context), {
            apiKey: "test-key",
            onProviderStreamEvent: (event, eventModel) =>
              Effect.runPromiseWith(effectContext)(
                Effect.gen(function* () {
                  yield* Effect.promise(() => Promise.resolve());
                  received.push(event);
                  eventModels.push(eventModel);
                }),
              ),
          }).result(),
        );

        expect(received).toEqual(wireEvents);
        expect(eventModels).toEqual(wireEvents.map(() => model));
        expect(message.stopReason).toBe("stop");
        expect(message.responseId).toBe("resp_1");
        expect(message.content).toEqual([
          { type: "text", text: "Hello", textSignature: undefined },
        ]);
      }),
    ));
});

describe("msa-messages", () => {
  it("appends debug=1 and reports response headers via onResponse", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const { baseUrl, requests } = yield* Effect.promise(() =>
          startServer({
            headers: { "x-msa-gateway-upstream-provider": "anthropic" },
            events: [{ type: "done", reason: "stop", usage }],
          }),
        );
        const model = createModel(baseUrl);

        let observedHeaders: Record<string, string> | undefined;
        const options = {
          apiKey: "test-key",
          debug: true,
          onResponse: (response) => {
            observedHeaders = response.headers;
          },
        } satisfies MsaMessagesOptions;
        const message = yield* Effect.promise(() =>
          streamSimple(model, normalizeContext(context), options).result(),
        );

        expect(message.stopReason).toBe("stop");
        expect(requests[0]?.url).toBe("/v1/messages?debug=1");
        expect(observedHeaders?.["x-msa-gateway-upstream-provider"]).toBe("anthropic");
      }),
    ));
});

describe("msa-messages", () => {
  it("surfaces backend error responses with diagnostics", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const encodedJson = yield* encodeJson({
          error: { message: "Token expired", code: "unauthorized" },
        });
        const { baseUrl } = yield* Effect.promise(() =>
          startServer({
            status: 401,
            rawBody: encodedJson,
          }),
        );
        const model = createModel(baseUrl);

        const message = yield* Effect.promise(() =>
          stream(model, normalizeContext(context), { apiKey: "stale" }).result(),
        );

        expect(message.stopReason).toBe("error");
        expect(message.errorMessage).toContain("401");
        expect(message.errorMessage).toContain("Token expired");
        expect(message.errorMessage).toContain("unauthorized");
        expect(message.diagnostics?.[0]?.type).toBe("pi_messages_response_failure");
        expect(message.diagnostics?.[0]?.details?.["status"]).toBe(401);
      }),
    ));
});

describe("msa-messages", () => {
  it("propagates server-sent error events", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const { baseUrl } = yield* Effect.promise(() =>
          startServer({
            events: [
              { type: "start" },
              { type: "error", reason: "error", usage, errorMessage: "Upstream failed" },
            ],
          }),
        );
        const model = createModel(baseUrl);

        const message = yield* Effect.promise(() =>
          stream(model, normalizeContext(context), { apiKey: "test-key" }).result(),
        );

        expect(message.stopReason).toBe("error");
        expect(message.errorMessage).toBe("Upstream failed");
        expect(message.usage).toEqual(usage);
      }),
    ));
});

describe("msa-messages", () => {
  it("errors when no API key is provided", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const model = createModel("http://127.0.0.1:1/v1");

        const message = yield* Effect.promise(() =>
          stream(model, normalizeContext(context)).result(),
        );

        expect(message.stopReason).toBe("error");
        expect(message.errorMessage).toContain("No API key provided");
      }),
    ));

  it("errors when the stream ends without a terminal event", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const { baseUrl } = yield* Effect.promise(() =>
          startServer({
            events: [
              { type: "start" },
              { type: "text_start", contentIndex: 0 },
              { type: "text_delta", contentIndex: 0, delta: "partial" },
            ],
          }),
        );
        const model = createModel(baseUrl);

        const message = yield* Effect.promise(() =>
          stream(model, normalizeContext(context), { apiKey: "test-key" }).result(),
        );

        expect(message.stopReason).toBe("error");
        expect(message.errorMessage).toContain("stream ended without a terminal event");
      }),
    ));
});

describe("msa-messages api registration", () => {
  it("is registered as a builtin api provider", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const { getApiProvider } = yield* Effect.promise(() => import("../src/compat.ts"));
        expect(getApiProvider("msa-messages")).toBeDefined();
      }),
    ));

  it("is a known api usable on models", () => {
    const api: Api = "msa-messages";
    expect(api).toBe("msa-messages");
  });
});
