import { Effect } from "effect";
import { describe, expect, it, vi } from "vite-plus/test";

import { classify } from "../src/api/openai-decisions.ts";
import jsonCodec from "./json-codec.ts";
import openaiDecisionsSupport from "./openai-decisions-support.ts";

const { context, image, model, wireAnswers, wireUsage } = openaiDecisionsSupport;

const { decodeJson, encodeJson } = jsonCodec;

const mapsQuestionsToDecisionsTypesAnd = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const result = yield* mapsQuestionsToDecisionsTypesAndStep1();
      expect(result.stopReason).toBe("stop");
      expect(result.answers).toEqual({
        approved: { probability: 0.95, type: "bool" },
        category: {
          choice: "success",
          confidence: 0.8,
          probabilities: { failure: 0.1, success: 0.9 },
          type: "choice",
        },
        satisfaction: { confidence: 0.7, score: 1.8, type: "score" },
      });
      expect(result.usage).toMatchObject({
        cacheRead: 0,
        input: 164,
        output: 0,
        totalTokens: 164,
      });
      expect(result.usage?.cost.total).toBeCloseTo(0.0000164, 12);
    }),
  );

const pricesLongContextRequestsAtThe = () =>
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
  );

const sendsImagesAfterTheStateIn = () =>
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
          content: [
            { text: yield* encodeJson(context.state), type: "input_text" },
            { image_url: "data:image/png;base64,aW1hZ2U=", type: "input_image" },
            { image_url: "data:image/jpeg;base64,aW1hZ2U=", type: "input_image" },
          ],
          role: "user",
        },
      ]);
    }),
  );

const mapsQuestionsToDecisionsTypesAndStep1 = () =>
  Effect.gen(function* () {
    const fetch = vi.fn((_input: string | URL | Request, _init?: RequestInit) =>
      Promise.resolve(
        Response.json({
          answers: [...wireAnswers].reverse(),
          model: "gpt-6-luna",
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
      input: yield* encodeJson(context.state),
      model: "gpt-6-luna",
      questions: [
        {
          choices: [{ description: "Successful", value: "success" }, { value: "failure" }],
          instructions: "Classify the message",
          name: "category",
          type: "choice",
        },
        {
          instructions: "Score satisfaction",
          levels: [{ label: "low" }, { label: "neutral" }, { label: "high" }],
          name: "satisfaction",
          type: "score",
        },
        {
          instructions: "Does the user approve?\n\nTrue means: Approval\nFalse means: No approval",
          name: "approved",
          type: "predicate",
        },
      ],
    });
    return result;
  });

describe("OpenAI Decisions", () => {
  it(
    "maps questions to Decisions types and answers back by name",
    mapsQuestionsToDecisionsTypesAnd,
  );
});

describe("OpenAI Decisions", () => {
  it("prices long-context requests at the long-context input rate", pricesLongContextRequestsAtThe);
});

describe("OpenAI Decisions", () => {
  it("sends images after the state in one user message", sendsImagesAfterTheStateIn);
});
