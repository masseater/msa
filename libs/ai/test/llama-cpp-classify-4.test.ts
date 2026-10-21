import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";

import llamaCppClassify from "../src/api/llama-cpp-classify.ts";
import type typesModule from "../src/types.types.ts";
import llamaCppClassifySupport from "./llama-cpp-classify-support.ts";

const { answerFromProbabilities, classify, llamaServerRoot, peakConfidence } = llamaCppClassify;

const { context, fakeServer, model } = llamaCppClassifySupport;
const passesCompletionPayloadsAndResponsesThrough = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const server = fakeServer();
      const payloads: unknown[] = [];
      const statuses: number[] = [];
      const options: typesModule.ClassifierOptions = {
        fetch: server.fetch,
        onPayload: (payload) => {
          payloads.push(payload);
          return { ...(payload as object), id_slot: 1 };
        },
        onResponse: (response) => {
          statuses.push(response.status);
        },
      };

      yield* Effect.promise(() =>
        classify(
          model(),
          {
            questions: {
              pick: { criteria: { a: "", b: "" }, instructions: "Pick", type: "choice" },
            },
            state: {},
          },
          options,
        ),
      );

      expect(payloads).toHaveLength(1);
      expect(payloads[0]).toMatchObject({ n_predict: 1 });
      expect(statuses).toEqual([200]);
      expect(
        server.requests.find((request) => request.url.endsWith("/completion"))?.body["id_slot"],
      ).toBe(1);
    }),
  );

const reportsServerErrorsAndCancellation = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const failing = yield* Effect.promise(() =>
        classify(model(), context, {
          fetch: () =>
            Promise.resolve(
              new Response('{"error":{"message":"context overflow"}}', { status: 400 }),
            ),
          maxRetries: 0,
        }),
      );
      expect(failing.stopReason).toBe("error");
      expect(failing.errorMessage).toContain("llama.cpp error (400)");
      expect(failing.errorMessage).toContain("context overflow");

      const controllerSignal = AbortSignal.abort();
      const aborted = yield* Effect.promise(() =>
        classify(model(), context, {
          fetch: (_input, init) => {
            init?.signal?.throwIfAborted();
            return Promise.resolve(Response.json({}));
          },
          signal: controllerSignal,
        }),
      );
      expect(aborted.stopReason).toBe("aborted");
    }),
  );

const rejectsModelsForOtherClassifierAPIs = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const server = fakeServer();
      const result = yield* Effect.promise(() =>
        classify({ ...model(), api: "typesafe-system-one" }, context, {
          fetch: server.fetch,
        }),
      );

      expect(result.errorMessage).toContain("Unsupported classifier API: typesafe-system-one");
      expect(server.requests).toEqual([]);
    }),
  );

const derivesTheServerRootFromOpenAI = () => {
  expect(llamaServerRoot("http://127.0.0.1:8080/v1/")).toBe("http://127.0.0.1:8080");
  expect(llamaServerRoot("https://example.com/prefix/v1")).toBe("https://example.com/prefix");
  expect(llamaServerRoot("http://127.0.0.1:8080")).toBe("http://127.0.0.1:8080");
};

const computesTypeSafeSConfidenceAndExpected = () => {
  expect(peakConfidence([0.89, 0.06, 0.05])).toBeCloseTo(0.835);
  expect(peakConfidence([0.5, 0.5])).toBe(0);
  expect(peakConfidence([1, 0, 0])).toBe(1);
  expect(
    answerFromProbabilities(
      { criteria: ["a", "b", "c"], instructions: "", type: "score" },
      ["0", "1", "2"],
      [0.2, 0.3, 0.5],
    ),
  ).toEqual({ confidence: peakConfidence([0.2, 0.3, 0.5]), score: 1.3, type: "score" });
};

describe("llama.cpp classifier", () => {
  it(
    "passes completion payloads and responses through the request hooks",
    passesCompletionPayloadsAndResponsesThrough,
  );
});

describe("llama.cpp classifier", () => {
  it("reports server errors and cancellation", reportsServerErrorsAndCancellation);

  it("rejects models for other classifier APIs", rejectsModelsForOtherClassifierAPIs);
});

describe("llama.cpp classifier", () => {
  it("derives the server root from OpenAI-compatible base URLs", derivesTheServerRootFromOpenAI);
});

describe("llama.cpp classifier", () => {
  it("computes TypeSafe's confidence and expected scores", computesTypeSafeSConfidenceAndExpected);
});
