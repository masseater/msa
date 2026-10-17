import { readFileSync } from "node:fs";
import { join } from "node:path";

import { Console, Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";

import { getImageModel } from "../src/image-models.ts";
import { generateImages } from "../src/images.ts";
import type {
  ImageContent,
  ImageModel,
  ImagesContext,
  ProviderImagesOptions,
} from "../src/types.ts";
import { envValue } from "./env.ts";

type ImagesOptionsWithExtras = ProviderImagesOptions & Record<string, unknown>;

const basicImageGeneration = Effect.fn("basicImageGeneration")(function* <TApi extends string>(
  model: ImageModel<TApi>,
  options?: ImagesOptionsWithExtras,
) {
  const context: ImagesContext = {
    input: [
      { type: "text", text: "Generate a simple red circle on a plain white background. No text." },
    ],
  };

  const response = yield* Effect.promise(() => generateImages(model, context, options));

  expect(response.stopReason, `Error: ${response.errorMessage}`).toBe("stop");
  expect(response.errorMessage).toBeFalsy();
  expect(response.output.some((item) => item.type === "image")).toBe(true);
  expect(response.timestamp).toBeGreaterThan(0);
});

const handleImageInput = Effect.fn("handleImageInput")(function* <TApi extends string>(
  model: ImageModel<TApi>,
  options?: ImagesOptionsWithExtras,
) {
  if (!model.input.includes("image")) {
    yield* Console.log(`Skipping image input test - model ${model.id} doesn't support image input`);
    return;
  }

  const imagePath = join(import.meta.dirname, "data", "red-circle.png");
  const imageBuffer = readFileSync(imagePath);
  const imageContent: ImageContent = {
    type: "image",
    data: imageBuffer.toString("base64"),
    mimeType: "image/png",
  };

  const context: ImagesContext = {
    input: [
      { type: "text", text: "Create a variation of this image with a blue background." },
      imageContent,
    ],
  };

  const response = yield* Effect.promise(() => generateImages(model, context, options));

  expect(response.stopReason, `Error: ${response.errorMessage}`).toBe("stop");
  expect(response.output.some((item) => item.type === "image")).toBe(true);
});

describe("Images E2E Tests", () => {
  describe.skipIf(
    envValue("OPENROUTER_API_KEY") === undefined || envValue("OPENROUTER_API_KEY") === "",
  )("OpenRouter Images Provider (google/gemini-2.5-flash-image)", () => {
    const model = getImageModel("openrouter", "google/gemini-2.5-flash-image");

    it("should generate a basic image", { retry: 3 }, () =>
      Effect.runPromise(basicImageGeneration(model)),
    );

    it("should handle image input", { retry: 3 }, () => Effect.runPromise(handleImageInput(model)));
  });
});
