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

const OLLAMA_FINGERPRINT = "fp_ollama";

const chatStream = (fingerprint?: string) => () => {
  const chunk = {
    choices: [{ delta: { content: "ok" }, finish_reason: "stop", index: 0 }],
    created: 0,
    id: "chatcmpl-test",
    model: "test-model",
    object: "chat.completion.chunk",
    ...(fingerprint === undefined ? {} : { system_fingerprint: fingerprint }),
  };
  return new Response(`data: ${JSON.stringify(chunk)}\n\ndata: [DONE]\n\n`, {
    headers: { "content-type": "text/event-stream" },
    status: 200,
  });
};

const ollamaRoot = () =>
  new Response("Ollama is running", {
    headers: { "content-type": "text/plain; charset=utf-8" },
    status: 200,
  });

const jsonError = (status: number, body: string) => () =>
  new Response(body, { headers: { "content-type": "application/json" }, status });

const notFound = (body: string) => jsonError(404, body);

interface Exchange {
  readonly method: string;
  readonly url: string;
  readonly body: Record<string, unknown> | undefined;
}

const readBody = (request: Request): Promise<Record<string, unknown> | undefined> =>
  request.method === "GET"
    ? Promise.resolve(undefined)
    : request.json().then((body) => body as Record<string, unknown>);

interface ServerShape {
  readonly root: (request: Request) => Promise<Response>;
  readonly chat: () => Response;
}

function serverAt(shape: ServerShape) {
  const exchanges: Exchange[] = [];
  const fetch = vi.fn<typesModule.FetchFunction>((input, init) => {
    const request = new Request(input, init);
    return readBody(request).then((body) => {
      exchanges.push({ body, method: request.method, url: request.url });
      return request.method === "GET" ? shape.root(request) : shape.chat();
    });
  });
  return { exchanges, fetch };
}

const answering =
  (response: () => Response): ServerShape["root"] =>
  () =>
    Promise.resolve(response());

const ollamaServer = () =>
  serverAt({ chat: chatStream(OLLAMA_FINGERPRINT), root: answering(ollamaRoot) });

const otherServer = (root: () => Response, fingerprint?: string) =>
  serverAt({ chat: chatStream(fingerprint), root: answering(root) });

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

const sentFields = (exchanges: readonly Exchange[]) =>
  chatPayloads(exchanges).map((payload) =>
    payload?.["max_tokens"] === 123 ? "max_tokens" : "max_completion_tokens",
  );

const sendsMaxTokensToOllama = ([provider, baseUrl, root]: readonly [string, string, string]) =>
  Effect.runPromise(
    Effect.gen(function* () {
      vi.stubGlobal("fetch", () => Promise.reject(new Error("ambient fetch must not be called")));
      const server = ollamaServer();
      yield* send(customModel(provider, baseUrl), server.fetch);
      expect(probedUrls(server.exchanges)).toEqual([root]);
      expectField(server.exchanges, "max_tokens");
    }),
  );

const sendsMaxCompletionTokensToNonOllama = ([provider, baseUrl, root, fingerprint]: readonly [
  string,
  string,
  () => Response,
  string | undefined,
]) =>
  Effect.runPromise(
    Effect.gen(function* () {
      const server = otherServer(root, fingerprint);
      yield* send(customModel(provider, baseUrl), server.fetch);
      expect(probedUrls(server.exchanges)).toHaveLength(1);
      expectField(server.exchanges, "max_completion_tokens");
    }),
  );

const skipsProbe = (model: typesModule.Model<"openai-completions">) => () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const server = ollamaServer();
      yield* send(model, server.fetch);
      expect(probedUrls(server.exchanges)).toEqual([]);
      expectField(server.exchanges, "max_completion_tokens");
    }),
  );

const reusesProbeAnswer = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const server = ollamaServer();
      const model = customModel("home-box", "http://127.0.0.1:8282/v1");
      yield* send(model, server.fetch);
      yield* send(model, server.fetch);
      expect(probedUrls(server.exchanges)).toHaveLength(1);
      expect(sentFields(server.exchanges)).toEqual(["max_tokens", "max_tokens"]);
    }),
  );

const sharesConcurrentProbe = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const server = ollamaServer();
      const model = customModel("home-box", "http://127.0.0.1:8585/v1");
      yield* Effect.all([send(model, server.fetch), send(model, server.fetch)], {
        concurrency: "unbounded",
      });
      expect(probedUrls(server.exchanges)).toHaveLength(1);
      expect(sentFields(server.exchanges)).toEqual(["max_tokens", "max_tokens"]);
    }),
  );

const followsSwappedServer = ([port, before, after]: readonly [
  number,
  () => ReturnType<typeof serverAt>,
  () => ReturnType<typeof serverAt>,
]) =>
  Effect.runPromise(
    Effect.gen(function* () {
      const model = customModel("home-box", `http://127.0.0.1:${port}/v1`);
      const first = before();
      yield* send(model, first.fetch);
      const second = after();
      yield* send(model, second.fetch);
      yield* send(model, second.fetch);
      expect(probedUrls(second.exchanges)).toEqual([]);
      const [beforeField] = sentFields(first.exchanges);
      const afterFields = sentFields(second.exchanges);
      expect(afterFields[0]).toBe(beforeField);
      expect(afterFields[1]).not.toBe(beforeField);
    }),
  );

const lmStudio = () => otherServer(notFound('{"error":"Unexpected endpoint"}'));

const hangs: ServerShape["root"] = (request) =>
  Effect.runPromise(Effect.never, { signal: request.signal });

const refuses: ServerShape["root"] = () => Promise.reject(new TypeError("fetch failed"));

const HOUR_MS = 3_600_000;

const boundsProbesOfFailingRoot = ([port, root]: readonly [number, ServerShape["root"]]) =>
  Effect.runPromise(
    Effect.gen(function* () {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(0);
      const model = customModel("gateway", `http://127.0.0.1:${port}/v1`);
      const failing = serverAt({ chat: jsonError(502, '{"error":"bad gateway"}'), root });
      for (let attempt = 0; attempt < 20; attempt += 1) {
        yield* send(model, failing.fetch);
      }
      expect(probedUrls(failing.exchanges)).toHaveLength(1);
      expect(new Set(sentFields(failing.exchanges))).toEqual(new Set(["max_completion_tokens"]));
      vi.setSystemTime(HOUR_MS);
      const recovered = ollamaServer();
      yield* send(model, recovered.fetch);
      expect(probedUrls(recovered.exchanges)).toHaveLength(1);
      expectField(recovered.exchanges, "max_tokens");
    }),
  );

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("openai-completions max tokens field for Ollama", () => {
  it.for([
    ["home-box", "http://127.0.0.1:8080/v1", "http://127.0.0.1:8080/"],
    ["remote", "https://llm.example.test/ollama/v1/", "https://llm.example.test/ollama/"],
  ] as const)("sends max_tokens to Ollama for %s at %s", sendsMaxTokensToOllama);
  it.for([
    [
      "lm-studio",
      "http://127.0.0.1:1234/v1",
      notFound('{"error":"Unexpected endpoint"}'),
      undefined,
    ],
    ["vllm", "http://127.0.0.1:8000/v1", notFound('{"detail":"Not Found"}'), undefined],
    [
      "llama-cpp",
      "http://127.0.0.1:9090/v1",
      () => new Response("<html>llama.cpp</html>"),
      "b4567-0123abcd",
    ],
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
  it("shares one probe between concurrent first requests", sharesConcurrentProbe);
  it.for([
    [8686, lmStudio, ollamaServer],
    [8787, ollamaServer, lmStudio],
  ] as const)(
    "follows the server at port %i to its next answer after it is replaced",
    followsSwappedServer,
  );
  it.for([
    [8484, hangs],
    [8383, refuses],
    [8901, answering(jsonError(401, '{"error":"unauthorized"}'))],
    [8903, answering(jsonError(403, '{"error":"forbidden"}'))],
    [8929, answering(jsonError(429, '{"error":"rate limited"}'))],
    [8950, answering(jsonError(500, '{"error":"internal"}'))],
    [8953, answering(jsonError(503, '{"error":"unavailable"}'))],
  ] as const)(
    "asks the failing root at port %i once per interval and asks again after it",
    boundsProbesOfFailingRoot,
  );
});
