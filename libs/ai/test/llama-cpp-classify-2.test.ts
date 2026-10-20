import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";

import { classify, labelProbabilities, renderQuestion } from "../src/api/llama-cpp-classify.ts";
import type { ClassifierContext } from "../src/types.ts";
import llamaCppClassifySupport from "./llama-cpp-classify-support.ts";

const { context, fakeServer, model } = llamaCppClassifySupport;

interface RecordedRequest {
  url: string;
  body: Record<string, unknown>;
  headers: Headers;
}

const sharesEverythingBeforeTheFinalQuestion = () => {
  const prefix = (id: string) => {
    const { content } = renderQuestion(context, id);
    return content.slice(0, content.lastIndexOf("Question:"));
  };
  expect(prefix("urgent")).toBe(prefix("team"));
  expect(prefix("severity")).toBe(prefix("team"));
  expect(
    renderQuestion(context, "urgent").content.endsWith(
      "No means: No time pressure\n\nAnswer Yes or No.",
    ),
  ).toBe(true);
  expect(
    renderQuestion(context, "severity").content.endsWith(
      "2. high\n\nAnswer with one level number.",
    ),
  ).toBe(true);
};

const dividesLabelLogProbabilitiesByThe = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const server = fakeServer({ next: () => ({ A: -0.1, B: -2.5 }) });
      const questions: ClassifierContext["questions"] = {
        pick: { criteria: { a: "", b: "" }, instructions: "Pick one", type: "choice" },
      };

      const result = yield* Effect.promise(() =>
        classify(model(), { questions, state: {} }, { fetch: server.fetch, temperature: 2 }),
      );

      const expected = labelProbabilities([-0.1 / 2, -2.5 / 2], 1);
      expect(result.answers["pick"]).toMatchObject({
        probabilities: { a: expected[0], b: expected[1] },
      });
      expect(labelProbabilities([-0.1, -2.5], 2)).toEqual(expected);
    }),
  );

const rejectsNonPositiveTemperaturesBeforeSending = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const server = fakeServer();
      const result = yield* Effect.promise(() =>
        classify(model(), context, { fetch: server.fetch, temperature: 0 }),
      );

      expect(result.stopReason).toBe("error");
      expect(result.errorMessage).toContain("Temperature must be a positive number, got 0");
      expect(server.requests).toEqual([]);
    }),
  );

const retriesDeeperReadoutsWhenALabel = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const questions: ClassifierContext["questions"] = {
        pick: { criteria: { a: "", b: "" }, instructions: "Pick one", type: "choice" },
      };
      const deep = fakeServer({
        next: (_prompt, depth): Record<string, number> =>
          depth < 4096 ? { A: -0.1 } : { A: -0.1, B: -9 },
      });
      const recovered = yield* Effect.promise(() =>
        classify(model(), { questions, state: {} }, { fetch: deep.fetch }),
      );
      expect(recovered.stopReason).toBe("stop");
      expect(completionDepths(deep.requests)).toEqual([256, 4096]);

      const never = fakeServer({ next: () => ({ A: -0.1 }) });
      const failed = yield* Effect.promise(() =>
        classify(model(), { questions, state: {} }, { fetch: never.fetch }),
      );
      expect(failed.stopReason).toBe("error");
      expect(failed.answers).toEqual({});
      expect(failed.errorMessage).toContain(
        "did not rank labels B for pick within the top 32768 tokens",
      );
      expect(completionDepths(never.requests)).toEqual([256, 4096, 32768]);
    }),
  );

function completionDepths(requests: RecordedRequest[]): number[] {
  return requests
    .filter((request) => request.url.endsWith("/completion"))
    .map((request) => Number(request.body["n_probs"]));
}

describe("llama.cpp classifier", () => {
  it(
    "shares everything before the final question across the questions of a request",
    sharesEverythingBeforeTheFinalQuestion,
  );

  it("divides label log-probabilities by the temperature", dividesLabelLogProbabilitiesByThe);
});

describe("llama.cpp classifier", () => {
  it(
    "rejects non-positive temperatures before sending requests",
    rejectsNonPositiveTemperaturesBeforeSending,
  );

  it(
    "retries deeper readouts when a label is missing and fails without inventing zeros",
    retriesDeeperReadoutsWhenALabel,
  );
});
