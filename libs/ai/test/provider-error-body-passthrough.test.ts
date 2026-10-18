import { Data, Effect } from "effect";
import { describe, expect, it, vi } from "vite-plus/test";

import { generateImages } from "../src/images.ts";
import type { ImageModel, ImagesContext } from "../src/types.ts";

class FakeAPIError extends Data.TaggedError("PermissionDeniedError")<{
  readonly message: string;
  readonly status: number;
  readonly error: unknown;
}> {}

vi.mock("openai", () => {
  class FakeOpenAI {
    chat = {
      completions: {
        create: () => {
          const promise = Promise.resolve(undefined) as unknown as {
            withResponse: () => Promise<never>;
          };
          promise.withResponse = () =>
            Promise.reject(
              new FakeAPIError({
                message: "403 status code (no body)",
                status: 403,
                error: { error: "blocked by gateway WAF" },
              }),
            );
          return promise;
        },
      },
    };
  }
  return { default: FakeOpenAI };
});

describe("provider error body passthrough", () => {
  it("surfaces the HTTP body reason instead of the opaque SDK message (openrouter images)", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const model: ImageModel<"openrouter-images"> = {
          type: "image",
          id: "black-forest-labs/flux.2-pro",
          name: "FLUX.2 Pro",
          api: "openrouter-images",
          provider: "openrouter",
          baseUrl: "https://openrouter.ai/api/v1",
          input: ["text", "image"],
          output: ["image"],
          cost: { input: 0.015, output: 0.03, cacheRead: 0, cacheWrite: 0 },
        };
        const context: ImagesContext = {
          input: [{ type: "text", text: "Generate a dog" }],
        };

        const output = yield* Effect.promise(() =>
          generateImages(model, context, { apiKey: "test" }),
        );

        expect(output.stopReason).toBe("error");
        expect(output.errorMessage).toContain("403");
        expect(output.errorMessage).toContain("blocked by gateway WAF");
        expect(output.errorMessage).not.toBe("403 status code (no body)");
      }),
    ));
});
