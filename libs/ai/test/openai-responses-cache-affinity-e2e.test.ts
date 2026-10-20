import { Clock, Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";

import { complete } from "../src/compat.ts";
import type { Context } from "../src/types.ts";
import env from "./env.ts";
import modelChoice from "./model-choice.ts";

const { chooseModel, usesApi } = modelChoice;

const { envValue } = env;

describe.skipIf(envValue("OPENAI_API_KEY") === undefined || envValue("OPENAI_API_KEY") === "")(
  "openai responses cache affinity e2e",
  () => {
    it(
      "handles direct OpenAI Responses requests with aligned cache-affinity identifiers",
      { retry: 2 },
      () =>
        Effect.runPromise(
          Effect.gen(function* () {
            const model = chooseModel(
              "openai",
              "reasoning Responses",
              (candidate) => usesApi("openai-responses")(candidate) && candidate.reasoning,
            );
            const sessionId = "0195d6e4-4cf9-7f44-a2d8-f8f7f49ee9d3";
            const context: Context = {
              messages: [
                {
                  content: "Reply with exactly: openai cache affinity e2e success",
                  role: "user",
                  timestamp: yield* Clock.currentTimeMillis,
                },
              ],
              systemPrompt: "You are a helpful assistant. Reply exactly as requested.",
            };

            const response = yield* Effect.promise(() =>
              complete(model, context, {
                apiKey: envValue("OPENAI_API_KEY")!,
                sessionId,
              }),
            );

            expect(response.stopReason, response.errorMessage).not.toBe("error");
            expect(response.errorMessage).toBeUndefined();
            expect(
              response.content.map((block) => (block.type === "text" ? block.text : "")).join(""),
            ).toContain("openai cache affinity e2e success");
          }),
        ),
    );
  },
);
