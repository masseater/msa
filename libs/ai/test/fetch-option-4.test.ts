import { Effect } from "effect";
import { afterEach, describe, it, vi } from "vite-plus/test";

import { generateImages } from "../src/api/openrouter-images.ts";
import type { ImageModel } from "../src/types.ts";
import fetchOptionSupport from "./fetch-option-support.ts";

const { createModel, expectOnlyCustomFetch, mockFetches } = fetchOptionSupport;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("fetch stream option", () => {
  it("uses fetch for image generation", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const { custom, fallback } = mockFetches();
        const model: ImageModel<"openrouter-images"> = {
          ...createModel("openrouter-images"),
          output: ["image"],
          provider: "openrouter",
          type: "image",
        };
        yield* Effect.promise(() =>
          generateImages(
            model,
            { input: [{ text: "draw", type: "text" }] },
            {
              apiKey: "test-key",
              fetch: custom,
              maxRetries: 0,
            },
          ),
        );
        expectOnlyCustomFetch(custom, fallback);
      }),
    ));
});
