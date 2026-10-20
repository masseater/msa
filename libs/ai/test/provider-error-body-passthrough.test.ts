import { Effect } from "effect";
import { describe, expect, it, vi } from "vite-plus/test";

import { generateImages } from "../src/images.ts";
import type { ImageModel, ImagesContext } from "../src/types.ts";

vi.mock("openai", () =>
  import("./openai-permission-denied-mock.ts").then((module) => module.default),
);

describe("provider error body passthrough", () => {
  it("surfaces the HTTP body reason instead of the opaque SDK message (openrouter images)", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const model: ImageModel<"openrouter-images"> = {
          api: "openrouter-images",
          baseUrl: "https://openrouter.ai/api/v1",
          cost: { cacheRead: 0, cacheWrite: 0, input: 0.015, output: 0.03 },
          id: "black-forest-labs/flux.2-pro",
          input: ["text", "image"],
          name: "FLUX.2 Pro",
          output: ["image"],
          provider: "openrouter",
          type: "image",
        };
        const context: ImagesContext = {
          input: [{ text: "Generate a dog", type: "text" }],
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
