import { Console, Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";

import imageModelsModule from "../src/image-models.ts";
import images from "../src/images.ts";
import type typesModule from "../src/types.types.ts";
import env from "./env.ts";
import redCircle from "./red-circle.ts";

const { generateImages } = images;
const { getImageModels } = imageModelsModule;

const { envValue } = env;

type ImagesOptionsWithExtras = typesModule.ProviderImagesOptions & Record<string, unknown>;

const basicImageGeneration = Effect.fn("basicImageGeneration")(function* <TApi extends string>(
  model: typesModule.ImageModel<TApi>,
  options?: ImagesOptionsWithExtras,
) {
  const context: typesModule.ImagesContext = {
    input: [
      { text: "Generate a simple red circle on a plain white background. No text.", type: "text" },
    ],
  };

  const response = yield* Effect.promise(() => generateImages(model, context, options));

  expect(response.stopReason, `Error: ${response.errorMessage}`).toBe("stop");
  expect(response.errorMessage).toBeFalsy();
  expect(response.output.some((item) => item.type === "image")).toBe(true);
  expect(response.timestamp).toBeGreaterThan(0);
});

const handleImageInput = Effect.fn("handleImageInput")(function* <TApi extends string>(
  model: typesModule.ImageModel<TApi>,
  options?: ImagesOptionsWithExtras,
) {
  if (!model.input.includes("image")) {
    yield* Console.log(`Skipping image input test - model ${model.id} doesn't support image input`);
    return;
  }

  const imageContent: typesModule.ImageContent = {
    data: redCircle.data,
    mimeType: "image/png",
    type: "image",
  };

  const context: typesModule.ImagesContext = {
    input: [
      { text: "Create a variation of this image with a blue background.", type: "text" },
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
  )("OpenRouter Images Provider (image input)", () => {
    const [model] = getImageModels("openrouter")
      .filter((candidate) => candidate.input.includes("image"))
      .toSorted((a, b) => a.cost.input + a.cost.output - (b.cost.input + b.cost.output));
    if (model === undefined) throw new Error("The openrouter catalog has no image-input model");

    it("should generate a basic image", { retry: 3 }, () =>
      Effect.runPromise(basicImageGeneration(model)),
    );

    it("should handle image input", { retry: 3 }, () => Effect.runPromise(handleImageInput(model)));
  });
});
