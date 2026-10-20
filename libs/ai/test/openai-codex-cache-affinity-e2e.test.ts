import { Clock, Effect } from "effect";
import { describe, expect, inject, it } from "vite-plus/test";

import { complete } from "../src/compat.ts";
import type { Context } from "../src/types.ts";
import modelChoice from "./model-choice.ts";

const { chooseModel } = modelChoice;

const codexToken = inject("storedApiKeys")["openai-codex"];

describe("openai-codex cache affinity e2e", () => {
  it.skipIf(codexToken === undefined || codexToken === "")(
    "handles SSE requests with aligned cache-affinity identifiers",
    () =>
      Effect.runPromise(
        Effect.gen(function* () {
          const model = chooseModel("openai-codex", "Codex");
          const sessionId = "0195d6e4-4cf9-7f44-a2d8-f8f7f49ee9d3";
          const context: Context = {
            messages: [
              {
                content: "Reply with exactly: cache affinity e2e success",
                role: "user",
                timestamp: yield* Clock.currentTimeMillis,
              },
            ],
            systemPrompt: "You are a helpful assistant. Reply exactly as requested.",
          };

          const response = yield* Effect.promise(() =>
            complete(model, context, {
              apiKey: codexToken,
              sessionId,
              transport: "sse",
            }),
          );

          expect(response.stopReason, response.errorMessage).not.toBe("error");
          expect(response.errorMessage).toBeUndefined();
          expect(
            response.content.map((block) => (block.type === "text" ? block.text : "")).join(""),
          ).toContain("cache affinity e2e success");
        }),
      ),
  );
});
