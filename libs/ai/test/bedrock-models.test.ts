import { Clock, Console, Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";

import { complete, getModels } from "../src/compat.ts";
import type { Context } from "../src/types.ts";
import { hasBedrockCredentials } from "./bedrock-utils.ts";
import { envValue } from "./env.ts";

describe("Amazon Bedrock Models", () => {
  const models = getModels("amazon-bedrock");
  if (
    hasBedrockCredentials() &&
    envValue("BEDROCK_EXTENSIVE_MODEL_TEST") !== undefined &&
    envValue("BEDROCK_EXTENSIVE_MODEL_TEST") !== ""
  ) {
    for (const model of models) {
      it(`should make a simple request with ${model.id}`, { timeout: 10_000 }, () =>
        Effect.runPromise(
          Effect.gen(function* () {
            const context: Context = {
              systemPrompt: "You are a helpful assistant. Be extremely concise.",
              messages: [
                {
                  role: "user",
                  content: "Reply with exactly: 'OK'",
                  timestamp: yield* Clock.currentTimeMillis,
                },
              ],
            };

            const response = yield* Effect.promise(() => complete(model, context));

            expect(response.role).toBe("assistant");
            expect(response.content).toBeTruthy();
            expect(response.content.length).toBeGreaterThan(0);
            expect(response.usage.input + response.usage.cacheRead).toBeGreaterThan(0);
            expect(response.usage.output).toBeGreaterThan(0);
            expect(response.errorMessage).toBeFalsy();

            const textContent = response.content
              .filter((b) => b.type === "text")
              .map((b) => (b.type === "text" ? b.text : ""))
              .join("")
              .trim();
            expect(textContent).toBeTruthy();
            yield* Console.log(`${model.id}: ${textContent.slice(0, 100)}`);
          }),
        ),
      );
    }
  }
  it("should get all available Bedrock models", () => {
    expect(models.length).toBeGreaterThan(0);
    console.log(`Found ${models.length} Bedrock models`);
  });
});

describe("Amazon Bedrock Models", () => {
  const models = getModels("amazon-bedrock");
  if (
    hasBedrockCredentials() &&
    envValue("BEDROCK_EXTENSIVE_MODEL_TEST") !== undefined &&
    envValue("BEDROCK_EXTENSIVE_MODEL_TEST") !== ""
  ) {
    for (const model of models) {
      it(`should make a simple request with ${model.id}`, { timeout: 10_000 }, () =>
        Effect.runPromise(
          Effect.gen(function* () {
            const context: Context = {
              systemPrompt: "You are a helpful assistant. Be extremely concise.",
              messages: [
                {
                  role: "user",
                  content: "Reply with exactly: 'OK'",
                  timestamp: yield* Clock.currentTimeMillis,
                },
              ],
            };

            const response = yield* Effect.promise(() => complete(model, context));

            expect(response.role).toBe("assistant");
            expect(response.content).toBeTruthy();
            expect(response.content.length).toBeGreaterThan(0);
            expect(response.usage.input + response.usage.cacheRead).toBeGreaterThan(0);
            expect(response.usage.output).toBeGreaterThan(0);
            expect(response.errorMessage).toBeFalsy();

            const textContent = response.content
              .filter((b) => b.type === "text")
              .map((b) => (b.type === "text" ? b.text : ""))
              .join("")
              .trim();
            expect(textContent).toBeTruthy();
            yield* Console.log(`${model.id}: ${textContent.slice(0, 100)}`);
          }),
        ),
      );
    }
  }
  it("exposes Claude Opus 5 through an inference profile only", () => {
    expect(models.some((model) => model.id === "global.anthropic.claude-opus-5")).toBe(true);
    expect(models.some((model) => model.id === "anthropic.claude-opus-5")).toBe(false);
  });
});
