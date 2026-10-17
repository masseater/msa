import { Effect } from "effect";
import { describe, expect, it, vi } from "vite-plus/test";

import { classify } from "../src/api/openai-decisions.ts";
import type { ClassifierContext, ClassifierModel, ImageContent } from "../src/types.ts";
import { decodeJson, encodeJson } from "./json-codec.ts";

const model: ClassifierModel<"openai-decisions"> = {
  type: "classifier",
  id: "gpt-6-luna",
  name: "GPT-6 Luna",
  api: "openai-decisions",
  provider: "openai",
  baseUrl: "https://api.openai.com/v1",
  input: ["text", "image"],
  cost: {
    input: 0.1,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    tiers: [{ inputTokensAbove: 272000, input: 0.2, output: 0, cacheRead: 0, cacheWrite: 0 }],
  },
  contextWindow: 922000,
};

const context: ClassifierContext = {
  state: { text: "The deployment succeeded, thank you." },
  questions: {
    category: {
      type: "choice",
      instructions: "Classify the message",
      criteria: { success: "Successful", failure: "" },
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

const wireAnswers = [
  {
    type: "choice",
    name: "category",
    choice: "success",
    probabilities: [
      { value: "success", probability: 0.9 },
      { value: "failure", probability: 0.1 },
    ],
    confidence: 0.8,
  },
  {
    type: "score",
    name: "satisfaction",
    score: 1.8,
    probabilities: [
      { value: 0, label: "low", probability: 0.05 },
      { value: 1, label: "neutral", probability: 0.1 },
      { value: 2, label: "high", probability: 0.85 },
    ],
    confidence: 0.7,
  },
  { type: "predicate", name: "approved", probability: 0.95 },
];

const wireUsage = {
  input_tokens: 164,
  input_tokens_details: { cached_tokens: 0, cache_write_tokens: 0 },
  output_tokens: 0,
  output_tokens_details: { reasoning_tokens: 0 },
  total_tokens: 164,
};

const image: ImageContent = { type: "image", data: "aW1hZ2U=", mimeType: "image/png" };

describe("OpenAI Decisions", () => {
  it("maps questions to Decisions types and answers back by name", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const fetch = vi.fn((_input: string | URL | Request, _init?: RequestInit) =>
          Promise.resolve(
            Response.json({
              model: "gpt-6-luna",
              answers: [...wireAnswers].reverse(),
              usage: wireUsage,
            }),
          ),
        );

        const result = yield* Effect.promise(() =>
          classify(model, context, { apiKey: "secret", fetch, temperature: 1.5 }),
        );

        expect(fetch).toHaveBeenCalledOnce();
        const [url, init] = fetch.mock.calls[0]!;
        expect(String(url)).toBe("https://api.openai.com/v1/decisions");
        expect(new Headers(init?.headers).get("authorization")).toBe("Bearer secret");
        expect(yield* decodeJson(String(init?.body))).toEqual({
          model: "gpt-6-luna",
          input: yield* encodeJson(context.state),
          questions: [
            {
              type: "choice",
              name: "category",
              instructions: "Classify the message",
              choices: [{ value: "success", description: "Successful" }, { value: "failure" }],
            },
            {
              type: "score",
              name: "satisfaction",
              instructions: "Score satisfaction",
              levels: [{ label: "low" }, { label: "neutral" }, { label: "high" }],
            },
            {
              type: "predicate",
              name: "approved",
              instructions:
                "Does the user approve?\n\nTrue means: Approval\nFalse means: No approval",
            },
          ],
        });
        expect(result.stopReason).toBe("stop");
        expect(result.answers).toEqual({
          category: {
            type: "choice",
            choice: "success",
            probabilities: { success: 0.9, failure: 0.1 },
            confidence: 0.8,
          },
          satisfaction: { type: "score", score: 1.8, confidence: 0.7 },
          approved: { type: "bool", probability: 0.95 },
        });
        expect(result.usage).toMatchObject({
          input: 164,
          output: 0,
          cacheRead: 0,
          totalTokens: 164,
        });
        expect(result.usage?.cost.total).toBeCloseTo(0.0000164, 12);
      }),
    ));
});

describe("OpenAI Decisions", () => {
  it("prices long-context requests at the long-context input rate", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const result = yield* Effect.promise(() =>
          classify(model, context, {
            apiKey: "secret",
            fetch: () =>
              Promise.resolve(
                Response.json({
                  answers: wireAnswers,
                  usage: { input_tokens: 300000, output_tokens: 0 },
                }),
              ),
          }),
        );

        expect(result.usage?.cost.total).toBeCloseTo(0.06, 12);
      }),
    ));
});

describe("OpenAI Decisions", () => {
  it("sends images after the state in one user message", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const fetch = vi.fn((_input: string | URL | Request, _init?: RequestInit) =>
          Promise.resolve(Response.json({ answers: wireAnswers })),
        );

        const result = yield* Effect.promise(() =>
          classify(
            model,
            { ...context, images: [image, { ...image, mimeType: "image/jpeg" }] },
            {
              apiKey: "secret",
              fetch,
            },
          ),
        );

        expect(result.stopReason).toBe("stop");
        expect(
          ((yield* decodeJson(String(fetch.mock.calls[0]?.[1]?.body))) as { input: unknown }).input,
        ).toEqual([
          {
            role: "user",
            content: [
              { type: "input_text", text: yield* encodeJson(context.state) },
              { type: "input_image", image_url: "data:image/png;base64,aW1hZ2U=" },
              { type: "input_image", image_url: "data:image/jpeg;base64,aW1hZ2U=" },
            ],
          },
        ]);
      }),
    ));
});

describe("OpenAI Decisions", () => {
  it("rejects more than 128 images before sending", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const fetch = vi.fn(() => Promise.resolve(Response.json({ answers: wireAnswers })));

        const result = yield* Effect.promise(() =>
          classify(
            model,
            { ...context, images: Array.from({ length: 129 }, () => image) },
            {
              apiKey: "secret",
              fetch,
            },
          ),
        );

        expect(fetch).not.toHaveBeenCalled();
        expect(result.stopReason).toBe("error");
        expect(result.errorMessage).toContain("at most 128 images, got 129");
      }),
    ));

  it("fails the result when a question is refused and keeps the billed usage", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const result = yield* Effect.promise(() =>
          classify(model, context, {
            apiKey: "secret",
            fetch: () =>
              Promise.resolve(
                Response.json({
                  answers: [wireAnswers[0], wireAnswers[1], { type: "refusal", name: "approved" }],
                  usage: wireUsage,
                }),
              ),
          }),
        );

        expect(result.stopReason).toBe("error");
        expect(result.answers).toEqual({});
        expect(result.errorMessage).toBe("OpenAI Decisions refused to answer approved");
        expect(result.usage).toMatchObject({ input: 164 });
      }),
    ));
});

describe("OpenAI Decisions", () => {
  it("returns missing and mistyped answers as classifier errors", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const missing = yield* Effect.promise(() =>
          classify(model, context, {
            apiKey: "secret",
            fetch: () => Promise.resolve(Response.json({ answers: wireAnswers.slice(0, 2) })),
          }),
        );
        const mistyped = yield* Effect.promise(() =>
          classify(model, context, {
            apiKey: "secret",
            fetch: () =>
              Promise.resolve(
                Response.json({
                  answers: [wireAnswers[0], wireAnswers[1], { type: "score", name: "approved" }],
                }),
              ),
          }),
        );

        expect(missing.stopReason).toBe("error");
        expect(missing.errorMessage).toContain("did not return an answer for approved");
        expect(mistyped.stopReason).toBe("error");
        expect(mistyped.errorMessage).toContain("did not return a predicate answer for approved");
      }),
    ));
});

describe("OpenAI Decisions", () => {
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
                Response.json({
                  answers: [{ type: "predicate", name: "__proto__", probability: 0.75 }],
                }),
              ),
          }),
        );

        expect(result.stopReason).toBe("stop");
        expect(Object.hasOwn(result.answers, "__proto__")).toBe(true);
        expect(result.answers["__proto__"]).toEqual({ type: "bool", probability: 0.75 });
      }),
    ));
});

describe("OpenAI Decisions", () => {
  it("does not retry gateway timeouts and explains them instead of returning the HTML page", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const fetch = vi.fn(() =>
          Promise.resolve(
            new Response("<!DOCTYPE html><html>Gateway time-out</html>", {
              status: 504,
              headers: { "retry-after-ms": "0" },
            }),
          ),
        );
        const result = yield* Effect.promise(() =>
          classify(model, context, { apiKey: "secret", fetch }),
        );

        expect(fetch).toHaveBeenCalledOnce();
        expect(result.stopReason).toBe("error");
        expect(result.errorMessage).toContain(
          "OpenAI Decisions error (504): the request timed out at the gateway",
        );
        expect(result.errorMessage).not.toContain("<html>");
      }),
    ));

  it("still retries other server errors", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        let attempt = 0;
        const result = yield* Effect.promise(() =>
          classify(model, context, {
            apiKey: "secret",
            fetch: () =>
              Promise.resolve(
                ++attempt === 1
                  ? new Response("busy", { status: 503, headers: { "retry-after-ms": "0" } })
                  : Response.json({ answers: wireAnswers }),
              ),
          }),
        );

        expect(attempt).toBe(2);
        expect(result.stopReason).toBe("stop");
      }),
    ));
});

describe("OpenAI Decisions", () => {
  it("includes the API error body for other HTTP failures", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const result = yield* Effect.promise(() =>
          classify(model, context, {
            apiKey: "secret",
            maxRetries: 0,
            fetch: () =>
              Promise.resolve(
                Response.json(
                  {
                    error: {
                      message: "Decision input exceeds the token limit.",
                      type: "invalid_request_error",
                    },
                  },
                  { status: 400 },
                ),
              ),
          }),
        );

        expect(result.stopReason).toBe("error");
        expect(result.errorMessage).toContain("OpenAI Decisions error (400)");
        expect(result.errorMessage).toContain("Decision input exceeds the token limit.");
      }),
    ));

  it("rejects models for other classifier APIs and missing API keys", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const fetch = vi.fn(() => Promise.resolve(Response.json({ answers: wireAnswers })));
        const otherApi = yield* Effect.promise(() =>
          classify({ ...model, api: "typesafe-system-one" }, context, {
            apiKey: "secret",
            fetch,
          }),
        );
        const noKey = yield* Effect.promise(() => classify(model, context, { fetch }));

        expect(fetch).not.toHaveBeenCalled();
        expect(otherApi.errorMessage).toContain("Unsupported classifier API: typesafe-system-one");
        expect(noKey.errorMessage).toContain("No API key for provider: openai");
      }),
    ));
});
