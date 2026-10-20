import { Effect } from "effect";
import { describe, expect, it, vi } from "vite-plus/test";

import { classify } from "../src/api/typesafe-system-one.ts";
import typesafeSystemOneSupport from "./typesafe-system-one-support.ts";

const { context, model, wireAnswers } = typesafeSystemOneSupport;

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
        expect(result.answers["approved"]).toEqual({ probability: 0.95, type: "bool" });
        expect(result.answers["category"]).toMatchObject({ choice: "success", type: "choice" });
        expect(result.answers["satisfaction"]).toEqual({
          confidence: 0.7,
          score: 2,
          type: "score",
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
              answers: wireAnswers,
              id: "gen-dec-1",
              provider: "TypeSafe",
              usage: { cost: 0.000012936, input_tokens: 308, output_tokens: 23 },
            }),
          );
        });
        const openRouterModel = {
          ...model,
          baseUrl: "https://openrouter.ai/api/v1",
          cost: { ...model.cost, input: 0.042 },
          id: "typesafe/jev-1.13",
          provider: "openrouter",
        };

        const result = yield* Effect.promise(() =>
          classify(openRouterModel, context, { apiKey: "secret", fetch }),
        );

        expect(String(fetch.mock.calls[0]?.[0])).toBe("https://openrouter.ai/api/v1/systemone");
        expect(result.stopReason).toBe("stop");
        expect(result.answers["approved"]).toEqual({ probability: 0.95, type: "bool" });
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
            { ...context, images: [{ data: "aW1hZ2U=", mimeType: "image/png", type: "image" }] },
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
          headers: { "X-Source": "model", authorization: "Bearer model" },
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
