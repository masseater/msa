import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";

import { classify } from "../src/api/llama-cpp-classify.ts";
import type { ClassifierContext } from "../src/types.ts";
import llamaCppClassifySupport from "./llama-cpp-classify-support.ts";

const { charTokens, fakeServer, model } = llamaCppClassifySupport;
const closesAReasoningBlockTheTemplate = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const server = fakeServer({ template: () => "<|assistant|>\n<think>" });
      yield* Effect.promise(() =>
        classify(
          model(),
          {
            questions: {
              pick: { criteria: { a: "", b: "" }, instructions: "Pick", type: "choice" },
            },
            state: {},
          },
          { fetch: server.fetch },
        ),
      );

      const completion = server.requests.find((request) => request.url.endsWith("/completion"));
      expect(completion?.body["prompt"]).toBe("<|assistant|>\n<think></think>");
    }),
  );

const readsLabelsInReplyPositionAnd = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const merging = fakeServer({
        tokenize: (content) =>
          content.startsWith("\n") && content.length > 1 ? [1000] : charTokens(content),
      });
      const merged = yield* Effect.promise(() =>
        classify(
          model(),
          {
            questions: {
              pick: { criteria: { a: "", b: "" }, instructions: "Pick", type: "choice" },
            },
            state: {},
          },
          { fetch: merging.fetch },
        ),
      );
      expect(merged.stopReason).toBe("stop");

      const split = fakeServer();
      const result = yield* Effect.promise(() =>
        classify(
          model(),
          {
            questions: {
              ok: { criteria: { false: "", true: "" }, instructions: "OK?", type: "bool" },
            },
            state: {},
          },
          { fetch: split.fetch },
        ),
      );
      expect(result.stopReason).toBe("error");
      expect(result.errorMessage).toContain('Label "Yes" is not a single token for qwen');
    }),
  );

const cachesLabelTokensPerServerAnd = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const classifierModel = model();
      const server = fakeServer();
      const questions: ClassifierContext["questions"] = {
        pick: { criteria: { a: "", b: "" }, instructions: "Pick", type: "choice" },
      };
      yield* Effect.promise(() =>
        classify(classifierModel, { questions, state: {} }, { fetch: server.fetch }),
      );
      const firstTokenizations = server.requests.filter((request) =>
        request.url.endsWith("/tokenize"),
      ).length;
      yield* Effect.promise(() =>
        classify(classifierModel, { questions, state: {} }, { fetch: server.fetch }),
      );

      expect(firstTokenizations).toBeGreaterThan(0);
      expect(server.requests.filter((request) => request.url.endsWith("/tokenize"))).toHaveLength(
        firstTokenizations,
      );
    }),
  );

const validatesOptionCountsBeforeSendingRequests = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const server = fakeServer();
      const criteria = Object.fromEntries(
        Array.from({ length: 63 }, (_value, index) => [`option${index}`, ""]),
      );
      const tooMany = yield* Effect.promise(() =>
        classify(
          model(),
          { questions: { pick: { criteria, instructions: "Pick", type: "choice" } }, state: {} },
          { fetch: server.fetch },
        ),
      );
      const tooFew = yield* Effect.promise(() =>
        classify(
          model(),
          {
            questions: { rate: { criteria: ["only"], instructions: "Rate", type: "score" } },
            state: {},
          },
          { fetch: server.fetch },
        ),
      );

      expect(tooMany.errorMessage).toContain("A choice question needs 2 to 62 options, got 63");
      expect(tooFew.errorMessage).toContain("A score question needs 2 to 10 levels, got 1");
      expect(server.requests).toEqual([]);
    }),
  );

describe("llama.cpp classifier", () => {
  it("closes a reasoning block the template leaves open", closesAReasoningBlockTheTemplate);
});

describe("llama.cpp classifier", () => {
  it(
    "reads labels in reply position and rejects labels that are not one token",
    readsLabelsInReplyPositionAnd,
  );
});

describe("llama.cpp classifier", () => {
  it("caches label tokens per server and model", cachesLabelTokensPerServerAnd);
});

describe("llama.cpp classifier", () => {
  it("validates option counts before sending requests", validatesOptionCountsBeforeSendingRequests);
});
