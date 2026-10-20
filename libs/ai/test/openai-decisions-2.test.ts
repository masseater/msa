import { Effect } from "effect";
import { describe, expect, it, vi } from "vite-plus/test";

import { classify } from "../src/api/openai-decisions.ts";
import type { ClassifierContext } from "../src/types.ts";
import jsonCodec from "./json-codec.ts";
import openaiDecisionsSupport from "./openai-decisions-support.ts";

const { context, image, model, wireAnswers, wireUsage } = openaiDecisionsSupport;

const { decodeJson } = jsonCodec;

const rejectsMoreThan128ImagesBefore = () =>
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
  );

const failsTheResultWhenAQuestion = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const result = yield* Effect.promise(() =>
        classify(model, context, {
          apiKey: "secret",
          fetch: () =>
            Promise.resolve(
              Response.json({
                answers: [wireAnswers[0], wireAnswers[1], { name: "approved", type: "refusal" }],
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
  );

const returnsMissingAndMistypedAnswersAs = () =>
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
                answers: [wireAnswers[0], wireAnswers[1], { name: "approved", type: "score" }],
              }),
            ),
        }),
      );

      expect(missing.stopReason).toBe("error");
      expect(missing.errorMessage).toContain("did not return an answer for approved");
      expect(mistyped.stopReason).toBe("error");
      expect(mistyped.errorMessage).toContain("did not return a predicate answer for approved");
    }),
  );

const preservesPrototypeSensitiveQuestionIDsIn = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const prototypeContext: ClassifierContext = {
        questions: (yield* decodeJson(
          '{"__proto__":{"type":"bool","instructions":"Is this true?","criteria":{"true":"Yes","false":"No"}}}',
        )) as ClassifierContext["questions"],
        state: {},
      };
      const result = yield* Effect.promise(() =>
        classify(model, prototypeContext, {
          apiKey: "secret",
          fetch: () =>
            Promise.resolve(
              Response.json({
                answers: [{ name: "__proto__", probability: 0.75, type: "predicate" }],
              }),
            ),
        }),
      );

      expect(result.stopReason).toBe("stop");
      expect(Object.hasOwn(result.answers, "__proto__")).toBe(true);
      expect(result.answers["__proto__"]).toEqual({ probability: 0.75, type: "bool" });
    }),
  );

describe("OpenAI Decisions", () => {
  it("rejects more than 128 images before sending", rejectsMoreThan128ImagesBefore);

  it(
    "fails the result when a question is refused and keeps the billed usage",
    failsTheResultWhenAQuestion,
  );
});

describe("OpenAI Decisions", () => {
  it(
    "returns missing and mistyped answers as classifier errors",
    returnsMissingAndMistypedAnswersAs,
  );
});

describe("OpenAI Decisions", () => {
  it(
    "preserves prototype-sensitive question IDs in answers",
    preservesPrototypeSensitiveQuestionIDsIn,
  );
});
