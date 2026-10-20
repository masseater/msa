import { Effect, Stream } from "effect";
import { describe, expect, it } from "vite-plus/test";

import { stream } from "../src/compat.ts";
import type { Context, Model } from "../src/types.ts";
import { currentTimeMillis } from "../src/utils/clock.ts";
import { nextRandom } from "../src/utils/random.ts";
import env from "./env.ts";
import modelChoice from "./model-choice.ts";

const { chooseModel, usesApi } = modelChoice;

const { envValue } = env;

const withoutXhigh = () =>
  chooseModel(
    "openai",
    "reasoning Responses without xhigh",
    (candidate) =>
      usesApi("openai-responses")(candidate) &&
      candidate.reasoning &&
      candidate.thinkingLevelMap?.xhigh === null,
  );

function makeContext(): Context {
  return {
    messages: [
      {
        content: `What is ${(nextRandom() * 100) | 0} + ${(nextRandom() * 100) | 0}? Think step by step.`,
        role: "user",
        timestamp: currentTimeMillis(),
      },
    ],
  };
}

describe.skipIf(envValue("OPENAI_API_KEY") === undefined || envValue("OPENAI_API_KEY") === "")(
  "xhigh reasoning",
  () => {
    describe("gpt 5.5 (supports xhigh)", () => {
      it("should work with openai-responses", () =>
        Effect.runPromise(
          Effect.gen(function* () {
            const model = chooseModel(
              "openai",
              "xhigh Responses",
              (candidate) =>
                usesApi("openai-responses")(candidate) &&
                typeof candidate.thinkingLevelMap?.xhigh === "string",
            );
            const s = stream(model, makeContext(), { reasoningEffort: "xhigh" });
            let hasThinking = false;

            yield* Stream.fromAsyncIterable(s, (error) => error).pipe(
              Stream.orDie,
              Stream.runForEach((event) =>
                Effect.sync(() => {
                  if (event.type === "thinking_start" || event.type === "thinking_delta") {
                    hasThinking = true;
                  }
                }),
              ),
            );

            const response = yield* Effect.promise(() => s.result());
            expect(response.stopReason, `Error: ${response.errorMessage}`).toBe("stop");
            expect(response.content.some((b) => b.type === "text")).toBe(true);
            expect(hasThinking || response.content.some((b) => b.type === "thinking")).toBe(true);
          }),
        ));
    });
  },
);

describe.skipIf(envValue("OPENAI_API_KEY") === undefined || envValue("OPENAI_API_KEY") === "")(
  "xhigh reasoning",
  () => {
    describe("gpt-5-mini (does not support xhigh)", () => {
      it("should error with openai-responses when using xhigh", () =>
        Effect.runPromise(
          Effect.gen(function* () {
            const model = withoutXhigh();
            const s = stream(model, makeContext(), { reasoningEffort: "xhigh" });

            yield* Stream.fromAsyncIterable(s, (error) => error).pipe(
              Stream.orDie,
              Stream.runDrain,
            );

            const response = yield* Effect.promise(() => s.result());
            expect(response.stopReason).toBe("error");
            expect(response.errorMessage).toContain("xhigh");
          }),
        ));

      it("should error with openai-completions when using xhigh", () =>
        Effect.runPromise(
          Effect.gen(function* () {
            const { compat: _compat, ...baseModel } = withoutXhigh();
            void _compat;
            const model: Model<"openai-completions"> = {
              ...baseModel,
              api: "openai-completions",
            };
            const s = stream(model, makeContext(), { reasoningEffort: "xhigh" });

            yield* Stream.fromAsyncIterable(s, (error) => error).pipe(
              Stream.orDie,
              Stream.runDrain,
            );

            const response = yield* Effect.promise(() => s.result());
            expect(response.stopReason).toBe("error");
            expect(response.errorMessage).toContain("xhigh");
          }),
        ));
    });
  },
);
