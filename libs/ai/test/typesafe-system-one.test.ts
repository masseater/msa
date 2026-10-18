import { Effect } from "effect";
import { describe, expect, it, vi } from "vite-plus/test";

import { classify } from "../src/api/typesafe-system-one.ts";
import type { ClassifierContext, ClassifierModel } from "../src/types.ts";
import { decodeJson, encodeJson } from "./json-codec.ts";

const model: ClassifierModel<"typesafe-system-one"> = {
  type: "classifier",
  id: "jev-latest",
  name: "Jev",
  api: "typesafe-system-one",
  provider: "typesafe",
  baseUrl: "https://api.typesafe.ai/v1/",
  input: ["text"],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 64000,
};

const context: ClassifierContext = {
  state: { text: "The deployment succeeded, thank you." },
  questions: {
    category: {
      type: "choice",
      instructions: "Classify the message",
      criteria: { success: "Successful", failure: "Failed" },
    },
    satisfaction: {
      type: "score",
      instructions: "Score satisfaction",
      criteria: ["low", "neutral", "high"],
    },
    approved: {
      type: "bool",
      instructions: "Does the user approve?",
      criteria: { true: "Approval", false: "No approval" },
    },
  },
};

const wireAnswers = {
  category: {
    type: "choice",
    choice: "success",
    probabilities: { success: 0.9, failure: 0.1 },
    confidence: 0.8,
  },
  satisfaction: { type: "score", score: 2, confidence: 0.7 },
  approved: { type: "noul", noul: 0.95 },
};

describe("TypeSafe System One", () => {
  it("maps public bool questions and answers to TypeSafe noul values", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const fetch = vi.fn((_input: string | URL | Request, init?: RequestInit) => {
          const payload = JSON.parse(String(init?.body)) as {
            model: string;
            questions: Record<string, { type: string }>;
          };
          expect(payload.model).toBe("jev-latest");
          expect(payload.questions["category"]?.type).toBe("choice");
          expect(payload.questions["satisfaction"]?.type).toBe("score");
          expect(payload.questions["approved"]?.type).toBe("noul");
          expect(payload).not.toHaveProperty("temperature");
          expect(new Headers(init?.headers).get("authorization")).toBe("Bearer secret");
          return Promise.resolve(Response.json({ answers: wireAnswers }));
        });

        const result = yield* Effect.promise(() =>
          classify(model, context, { apiKey: "secret", fetch, temperature: 1.5 }),
        );
        const pricedResult = yield* Effect.promise(() =>
          classify({ ...model, cost: { ...model.cost, input: 0.042 } }, context, {
            apiKey: "secret",
            fetch: () =>
              Promise.resolve(
                Response.json({
                  answers: wireAnswers,
                  usage: { input_tokens: 308, output_tokens: 23 },
                }),
              ),
          }),
        );

        expect(fetch).toHaveBeenCalledOnce();
        expect(String(fetch.mock.calls[0]?.[0])).toBe("https://api.typesafe.ai/v1/systemone");
        expect(result.stopReason).toBe("stop");
        expect(result.answers["approved"]).toEqual({ type: "bool", probability: 0.95 });
        expect(result.answers["category"]).toMatchObject({ type: "choice", choice: "success" });
        expect(result.answers["satisfaction"]).toEqual({
          type: "score",
          score: 2,
          confidence: 0.7,
        });
        expect(result.usage).toBeUndefined();
        expect(pricedResult.usage).toMatchObject({ input: 308, output: 23, totalTokens: 331 });
        expect(pricedResult.usage?.cost.total).toBeCloseTo(0.000012936, 12);
      }),
    ));
});

describe("TypeSafe System One", () => {
  it("posts OpenRouter System One requests to its TypeSafe-compatible endpoint", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const fetch = vi.fn((_input: string | URL | Request, init?: RequestInit) => {
          expect(JSON.parse(String(init?.body))).toMatchObject({
            model: "typesafe/jev-1.13",
            state: context.state,
          });
          return Promise.resolve(
            Response.json({
              id: "gen-dec-1",
              provider: "TypeSafe",
              answers: wireAnswers,
              usage: { input_tokens: 308, output_tokens: 23, cost: 0.000012936 },
            }),
          );
        });
        const openRouterModel = {
          ...model,
          id: "typesafe/jev-1.13",
          provider: "openrouter",
          baseUrl: "https://openrouter.ai/api/v1",
          cost: { ...model.cost, input: 0.042 },
        };

        const result = yield* Effect.promise(() =>
          classify(openRouterModel, context, { apiKey: "secret", fetch }),
        );

        expect(String(fetch.mock.calls[0]?.[0])).toBe("https://openrouter.ai/api/v1/systemone");
        expect(result.stopReason).toBe("stop");
        expect(result.answers["approved"]).toEqual({ type: "bool", probability: 0.95 });
        expect(result.usage?.cost.total).toBeCloseTo(0.000012936, 12);
      }),
    ));
});

describe("TypeSafe System One", () => {
  it("rejects models for other classifier APIs", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const fetch = vi.fn(() => Promise.resolve(Response.json({ answers: wireAnswers })));
        const result = yield* Effect.promise(() =>
          classify({ ...model, api: "llama-cpp-classify" }, context, {
            apiKey: "secret",
            fetch,
          }),
        );

        expect(fetch).not.toHaveBeenCalled();
        expect(result.stopReason).toBe("error");
        expect(result.errorMessage).toContain("Unsupported classifier API: llama-cpp-classify");
      }),
    ));

  it("rejects image input before sending", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const fetch = vi.fn(() => Promise.resolve(Response.json({ answers: wireAnswers })));
        const result = yield* Effect.promise(() =>
          classify(
            { ...model, input: ["text", "image"] },
            { ...context, images: [{ type: "image", data: "aW1hZ2U=", mimeType: "image/png" }] },
            { apiKey: "secret", fetch },
          ),
        );

        expect(fetch).not.toHaveBeenCalled();
        expect(result.stopReason).toBe("error");
        expect(result.errorMessage).toBe("System One API does not support image input");
      }),
    ));
});

describe("TypeSafe System One", () => {
  it("merges headers case-insensitively and supports null suppression", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const requests: Array<Record<string, string>> = [];
        const fetch = vi.fn((_input: string | URL | Request, init?: RequestInit) => {
          requests.push(Object.fromEntries(new Headers(init?.headers)));
          return Promise.resolve(Response.json({ answers: wireAnswers }));
        });
        const modelWithHeaders = {
          ...model,
          headers: { authorization: "Bearer model", "X-Source": "model" },
        };

        yield* Effect.promise(() =>
          classify(modelWithHeaders, context, {
            apiKey: "secret",
            fetch,
            headers: { Authorization: "Bearer request", "x-source": "request" },
          }),
        );
        yield* Effect.promise(() =>
          classify(modelWithHeaders, context, {
            apiKey: "secret",
            fetch,
            headers: { Authorization: null },
          }),
        );

        expect(requests[0]).toMatchObject({
          authorization: "Bearer request",
          "x-source": "request",
        });
        const [firstRequest] = requests;
        if (firstRequest === undefined) throw new Error("Expected a classify request");
        expect(
          Object.keys(firstRequest).filter((name) => name.toLowerCase() === "authorization"),
        ).toHaveLength(1);
        expect(requests[1]).not.toHaveProperty("authorization");
      }),
    ));
});

describe("TypeSafe System One", () => {
  it("preserves prototype-sensitive question IDs in answers", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const prototypeContext: ClassifierContext = {
          state: {},
          questions: (yield* decodeJson(
            '{"__proto__":{"type":"bool","instructions":"Is this true?","criteria":{"true":"Yes","false":"No"}}}',
          )) as ClassifierContext["questions"],
        };
        const result = yield* Effect.promise(() =>
          classify(model, prototypeContext, {
            apiKey: "secret",
            fetch: () =>
              Promise.resolve(
                Response.json({ answers: JSON.parse('{"__proto__":{"type":"noul","noul":0.75}}') }),
              ),
          }),
        );

        const serializedAnswers = (yield* decodeJson(yield* encodeJson(result.answers))) as Record<
          string,
          unknown
        >;
        expect(result.stopReason).toBe("stop");
        expect(Object.keys(result.answers)).toEqual(["__proto__"]);
        expect(Object.hasOwn(result.answers, "__proto__")).toBe(true);
        expect(result.answers["__proto__"]).toEqual({ type: "bool", probability: 0.75 });
        expect(serializedAnswers["__proto__"]).toEqual({ type: "bool", probability: 0.75 });
      }),
    ));
});

describe("TypeSafe System One", () => {
  it("reports request timeouts separately from caller cancellation", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const result = yield* Effect.promise(() =>
          classify(model, context, {
            apiKey: "secret",
            timeoutMs: 5,
            maxRetries: 0,
            fetch: (_input, init) => {
              const signal = init?.signal;
              if (signal === undefined || signal === null)
                return Promise.reject(new Error("missing request signal"));
              return Promise.resolve(
                new Promise<Response>((_resolve, reject) => {
                  signal.addEventListener("abort", () => reject(signal.reason), { once: true });
                }),
              );
            },
          }),
        );

        expect(result.stopReason).toBe("error");
        expect(result.errorMessage).toBe("Request timed out after 5ms");
      }),
    ));
});

describe("TypeSafe System One", () => {
  it("creates a fresh timeout for every retry attempt", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const signals: AbortSignal[] = [];
        let attempt = 0;
        const result = yield* Effect.promise(() =>
          classify(model, context, {
            apiKey: "secret",
            timeoutMs: 1000,
            maxRetries: 1,
            fetch: (_input, init) => {
              if (!(init?.signal instanceof AbortSignal))
                return Promise.reject(new Error("missing request signal"));
              signals.push(init.signal);
              attempt++;
              return Promise.resolve(
                attempt === 1
                  ? new Response("retry", { status: 500, headers: { "retry-after-ms": "0" } })
                  : Response.json({ answers: wireAnswers }),
              );
            },
          }),
        );

        expect(result.stopReason).toBe("stop");
        expect(signals).toHaveLength(2);
        expect(signals[0]).not.toBe(signals[1]);
      }),
    ));
});

describe("TypeSafe System One", () => {
  it("returns malformed responses as classifier errors", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const result = yield* Effect.promise(() =>
          classify(model, context, {
            apiKey: "secret",
            fetch: () =>
              Promise.resolve(
                Response.json({ answers: {}, usage: { input_tokens: 10, output_tokens: 2 } }),
              ),
          }),
        );

        expect(result.stopReason).toBe("error");
        expect(result.answers).toEqual({});
        expect(result.errorMessage).toContain("did not return an answer for category");
        expect(result.usage).toMatchObject({ input: 10, output: 2 });
      }),
    ));
});

describe("TypeSafe System One", () => {
  it("ignores malformed usage", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const result = yield* Effect.promise(() =>
          classify(model, context, {
            apiKey: "secret",
            fetch: () =>
              Promise.resolve(
                Response.json({
                  answers: wireAnswers,
                  usage: { input_tokens: "many", output_tokens: 3 },
                }),
              ),
          }),
        );
        const withoutTokens = yield* Effect.promise(() =>
          classify(model, context, {
            apiKey: "secret",
            fetch: () =>
              Promise.resolve(Response.json({ answers: wireAnswers, usage: { cost: 0.1 } })),
          }),
        );

        expect(result.stopReason).toBe("stop");
        expect(result.usage).toMatchObject({ input: 0, output: 3, totalTokens: 3 });
        expect(withoutTokens.stopReason).toBe("stop");
        expect(withoutTokens.usage).toBeUndefined();
      }),
    ));
});
