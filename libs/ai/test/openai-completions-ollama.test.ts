import { Effect } from "effect";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import openaiCompletions from "../src/api/openai-completions.ts";
import type typesModule from "../src/types.types.ts";
import transcript from "../src/utils/transcript.ts";
import modelChoice from "./model-choice.ts";

const { stream } = openaiCompletions;
const { normalizeContext } = transcript;
const { chooseModel } = modelChoice;

const context = normalizeContext({
  messages: [{ content: "hello", role: "user", timestamp: 1 }],
});

const finishedChunk = {
  choices: [{ delta: { content: "ok" }, finish_reason: "stop", index: 0 }],
  created: 0,
  id: "chatcmpl-test",
  model: "test-model",
  object: "chat.completion.chunk",
};

const chatStream = () =>
  new Response(`data: ${JSON.stringify(finishedChunk)}\n\ndata: [DONE]\n\n`, {
    headers: { "content-type": "text/event-stream" },
    status: 200,
  });

const ollamaRoot = () =>
  new Response("Ollama is running", {
    headers: { "content-type": "text/plain; charset=utf-8" },
    status: 200,
  });

const notFound = (body: string) =>
  new Response(body, { headers: { "content-type": "application/json" }, status: 404 });

interface Exchange {
  readonly method: string;
  readonly url: string;
  readonly body: Record<string, unknown> | undefined;
}

const readBody = (request: Request): Promise<Record<string, unknown> | undefined> =>
  request.method === "GET"
    ? Promise.resolve(undefined)
    : request.json().then((body) => body as Record<string, unknown>);

function serverAt(root: () => Response) {
  const exchanges: Exchange[] = [];
  const fetch = vi.fn<typesModule.FetchFunction>((input, init) => {
    const request = new Request(input, init);
    return readBody(request).then((body) => {
      exchanges.push({ body, method: request.method, url: request.url });
      return request.method === "GET" ? root() : chatStream();
    });
  });
  return { exchanges, fetch };
}

const customModel = (
  provider: string,
  baseUrl: string,
): typesModule.Model<"openai-completions"> => ({
  api: "openai-completions",
  baseUrl,
  contextWindow: 128000,
  cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0 },
  id: "test-model",
  input: ["text"],
  maxTokens: 16000,
  name: "Test Model",
  provider,
  reasoning: false,
});

const directOpenAIModel = (): typesModule.Model<"openai-completions"> => {
  const { compat: _compat, ...baseModel } = chooseModel("openai", "direct OpenAI");
  return { ...baseModel, api: "openai-completions" };
};

const send = (
  model: typesModule.Model<"openai-completions">,
  fetch: typesModule.FetchFunction,
): Effect.Effect<void> =>
  Effect.promise(() =>
    stream(model, context, { apiKey: "test-key", fetch, maxRetries: 0, maxTokens: 123 }).result(),
  ).pipe(Effect.asVoid);

const chatPayloads = (exchanges: readonly Exchange[]) =>
  exchanges.filter((exchange) => exchange.method === "POST").map((exchange) => exchange.body);

const probedUrls = (exchanges: readonly Exchange[]) =>
  exchanges.filter((exchange) => exchange.method === "GET").map((exchange) => exchange.url);

const expectField = (
  exchanges: readonly Exchange[],
  field: "max_tokens" | "max_completion_tokens",
) => {
  const [payload] = chatPayloads(exchanges);
  const other = field === "max_tokens" ? "max_completion_tokens" : "max_tokens";
  expect(payload?.[field]).toBe(123);
  expect(payload?.[other]).toBeUndefined();
};

const sendsMaxTokensToOllama = ([provider, baseUrl, root]: readonly [string, string, string]) =>
  Effect.runPromise(
    Effect.gen(function* () {
      vi.stubGlobal("fetch", () => Promise.reject(new Error("ambient fetch must not be called")));
      const server = serverAt(ollamaRoot);
      yield* send(customModel(provider, baseUrl), server.fetch);
      expect(probedUrls(server.exchanges)).toEqual([root]);
      expectField(server.exchanges, "max_tokens");
    }),
  );

const sendsMaxCompletionTokensToNonOllama = ([provider, baseUrl, root]: readonly [
  string,
  string,
  () => Response,
]) =>
  Effect.runPromise(
    Effect.gen(function* () {
      const server = serverAt(root);
      yield* send(customModel(provider, baseUrl), server.fetch);
      expect(probedUrls(server.exchanges)).toHaveLength(1);
      expectField(server.exchanges, "max_completion_tokens");
    }),
  );

const skipsProbe = (model: typesModule.Model<"openai-completions">) => () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const server = serverAt(ollamaRoot);
      yield* send(model, server.fetch);
      expect(probedUrls(server.exchanges)).toEqual([]);
      expectField(server.exchanges, "max_completion_tokens");
    }),
  );

const reusesProbeAnswer = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const server = serverAt(ollamaRoot);
      const model = customModel("home-box", "http://127.0.0.1:8282/v1");
      yield* send(model, server.fetch);
      yield* send(model, server.fetch);
      expect(probedUrls(server.exchanges)).toHaveLength(1);
      expect(chatPayloads(server.exchanges).map((payload) => payload?.["max_tokens"])).toEqual([
        123, 123,
      ]);
    }),
  );

const probesAgainAfterUnreachable = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const model = customModel("home-box", "http://127.0.0.1:8383/v1");
      const down = serverAt(ollamaRoot);
      down.fetch.mockImplementationOnce(() => Promise.reject(new TypeError("fetch failed")));
      yield* send(model, down.fetch);
      expectField(down.exchanges, "max_completion_tokens");
      const up = serverAt(ollamaRoot);
      yield* send(model, up.fetch);
      expect(probedUrls(up.exchanges)).toHaveLength(1);
      expectField(up.exchanges, "max_tokens");
    }),
  );

const sharesConcurrentProbe = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const server = serverAt(ollamaRoot);
      const model = customModel("home-box", "http://127.0.0.1:8585/v1");
      yield* Effect.all([send(model, server.fetch), send(model, server.fetch)], {
        concurrency: "unbounded",
      });
      expect(probedUrls(server.exchanges)).toHaveLength(1);
      expect(chatPayloads(server.exchanges).map((payload) => payload?.["max_tokens"])).toEqual([
        123, 123,
      ]);
    }),
  );

const probesAgainAfterUnauthorized = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const model = customModel("home-box", "http://127.0.0.1:8686/v1");
      const locked = serverAt(() => new Response('{"error":"unauthorized"}', { status: 401 }));
      yield* send(model, locked.fetch);
      expectField(locked.exchanges, "max_completion_tokens");
      const open = serverAt(ollamaRoot);
      yield* send(model, open.fetch);
      expect(probedUrls(open.exchanges)).toHaveLength(1);
      expectField(open.exchanges, "max_tokens");
    }),
  );

const hangingRoot = (fetch: ReturnType<typeof serverAt>["fetch"]) => {
  const answer = fetch.getMockImplementation();
  fetch.mockImplementation((input, init) => {
    const request = new Request(input, init);
    return request.method === "GET"
      ? Effect.runPromise(Effect.never, { signal: request.signal })
      : (answer?.(input, init) ?? Promise.reject(new Error("no server")));
  });
};

const remembersTimedOutProbe = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const model = customModel("slow-root", "http://127.0.0.1:8484/v1");
      const server = serverAt(ollamaRoot);
      hangingRoot(server.fetch);
      yield* send(model, server.fetch);
      yield* send(model, server.fetch);
      const getCalls = server.fetch.mock.calls.filter(
        ([input, init]) => new Request(input, init).method === "GET",
      );
      expect(getCalls).toHaveLength(1);
      expect(chatPayloads(server.exchanges).map((payload) => payload?.["max_tokens"])).toEqual([
        undefined,
        undefined,
      ]);
      expectField(server.exchanges, "max_completion_tokens");
    }),
  );

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("openai-completions max tokens field for Ollama", () => {
  it.for([
    ["home-box", "http://127.0.0.1:8080/v1", "http://127.0.0.1:8080/"],
    ["remote", "https://llm.example.test/ollama/v1/", "https://llm.example.test/ollama/"],
  ] as const)("sends max_tokens to Ollama for %s at %s", sendsMaxTokensToOllama);
  it.for([
    ["lm-studio", "http://127.0.0.1:1234/v1", () => notFound('{"error":"Unexpected endpoint"}')],
    ["vllm", "http://127.0.0.1:8000/v1", () => notFound('{"detail":"Not Found"}')],
    ["llama-cpp", "http://127.0.0.1:9090/v1", () => new Response("<html>llama.cpp</html>")],
  ] as const)("sends max_completion_tokens to %s at %s", sendsMaxCompletionTokensToNonOllama);
  it("sends max_completion_tokens to OpenAI without probing it", skipsProbe(directOpenAIModel()));
  it(
    "keeps a configured maxTokensField without probing",
    skipsProbe({
      ...customModel("pinned", "http://127.0.0.1:8181/v1"),
      compat: { maxTokensField: "max_completion_tokens" },
    }),
  );
  it("probes each server once and reuses the answer", reusesProbeAnswer);
  it("probes again after the server could not be reached", probesAgainAfterUnreachable);
  it("remembers a probe that timed out", remembersTimedOutProbe);
  it("shares one probe between concurrent first requests", sharesConcurrentProbe);
  it("probes again after the root refused the credentials", probesAgainAfterUnauthorized);
});
