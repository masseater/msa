import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";

import llamaCppClassify from "../src/api/llama-cpp-classify.ts";
import llamaCppClassifySupport from "./llama-cpp-classify-support.ts";

const { classify, labelProbabilities, peakConfidence, renderQuestion } = llamaCppClassify;

const { charTokens, context, fakeServer, model } = llamaCppClassifySupport;

function answerByPrompt(prompt: string): Record<string, number> {
  if (prompt.includes("Answer Yes or No.")) return { N: -3, Y: -0.05 };
  if (prompt.includes("Answer with one level number.")) return { "0": -4, "1": -1.8, "2": -0.2 };
  return { A: -1.5, B: -0.3, C: -3 };
}

function wordTokens(content: string): number[] {
  const words: Record<string, number> = { No: 78, Yes: 89 };
  const tokens: number[] = [];
  for (const part of content.split(/(\n)/u)) {
    if (part === "") continue;
    tokens.push(...(words[part] === undefined ? charTokens(part) : [words[part]]));
  }
  return tokens;
}

const answersChoiceBoolAndScoreQuestions = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const server = fakeServer({ next: answerByPrompt, tokenize: wordTokens });
      const classifierModel = model();

      const result = yield* Effect.promise(() =>
        classify(classifierModel, context, {
          apiKey: "local",
          fetch: server.fetch,
        }),
      );

      expect(result.errorMessage).toBeUndefined();
      expect(result.stopReason).toBe("stop");
      const choice = labelProbabilities([-1.5, -0.3, -3], 1);
      expect(result.answers["team"]).toEqual({
        choice: "technical",
        confidence: peakConfidence(choice),
        probabilities: { billing: choice[0], sales: choice[2], technical: choice[1] },
        type: "choice",
      });
      expect(result.answers["urgent"]).toEqual({
        probability: labelProbabilities([-0.05, -3], 1)[0],
        type: "bool",
      });
      const levels = labelProbabilities([-4, -1.8, -0.2], 1);
      expect(result.answers["severity"]).toEqual({
        confidence: peakConfidence(levels),
        score: levels[1]! + 2 * levels[2]!,
        type: "score",
      });

      const root = classifierModel.baseUrl.replace(/\/v1$/u, "");
      for (const request of server.requests) {
        expect(request.url.startsWith(`${root}/`)).toBe(true);
        expect(request.body["model"]).toBe("qwen");
        expect(request.headers.get("authorization")).toBe("Bearer local");
      }
      const completion = server.requests.find((request) => request.url.endsWith("/completion"));
      expect(completion?.body).toMatchObject({
        cache_prompt: true,
        n_predict: 1,
        n_probs: 256,
        post_sampling_probs: false,
      });
      const template = server.requests.find((request) => request.url.endsWith("/apply-template"));
      expect(template?.body["chat_template_kwargs"]).toEqual({ enable_thinking: false });
    }),
  );

const repeatsTheStateAroundAllQuestions = () => {
  const rendered = renderQuestion(context, "team");
  const state = 'State:\n{\n "message": "Help! My payouts have been failing for 3 days."\n}';
  expect(rendered.labels).toEqual(["A", "B", "C"]);
  expect(rendered.keys).toEqual(["billing", "technical", "sales"]);
  expect(rendered.content).toBe(
    [
      state,
      "",
      "Task: answer each of the following questions about the state.",
      "",
      "Question: Which team should handle this?",
      "",
      "Options:",
      "- billing: Payments and refunds",
      "- technical: Bugs and outages",
      "- sales",
      "",
      "Question: Does this convey urgency?",
      "",
      "Yes means: The user needs help soon",
      "No means: No time pressure",
      "",
      "Question: How severe is this?",
      "",
      "Levels:",
      "0. low",
      "1. medium",
      "2. high",
      "",
      state,
      "",
      "Question: Which team should handle this?",
      "",
      "Options:",
      "A. billing: Payments and refunds",
      "B. technical: Bugs and outages",
      "C. sales",
      "",
      "Answer with one letter.",
    ].join("\n"),
  );
};

describe("llama.cpp classifier", () => {
  it(
    "answers choice, bool and score questions from label log-probabilities",
    answersChoiceBoolAndScoreQuestions,
  );
});

describe("llama.cpp classifier", () => {
  it(
    "repeats the state around all questions and ends with this question's labels",
    repeatsTheStateAroundAllQuestions,
  );
});
