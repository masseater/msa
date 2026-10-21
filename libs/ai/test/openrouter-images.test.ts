import { Effect } from "effect";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

import imagesModule from "../src/images.ts";
import type typesModule from "../src/types.types.ts";

const { generateImages } = imagesModule;

const mockState = vi.hoisted(() => ({
  lastParams: undefined as unknown,
  lastRequestOptions: undefined as unknown,
}));

vi.mock("openai", () => {
  class FakeOpenAI {
    chat = {
      completions: {
        create: (params: unknown, requestOptions?: unknown) => {
          mockState.lastParams = params;
          mockState.lastRequestOptions = requestOptions;
          const signal = (requestOptions as { signal?: AbortSignal } | undefined)?.signal;
          if (signal?.aborted === true) {
            const error = new Error("Request aborted");
            return {
              withResponse: () => Promise.reject(error),
            };
          }
          const response = {
            choices: [
              {
                message: {
                  content: "Here is your image.",
                  images: [{ image_url: "data:image/png;base64,ZmFrZS1wbmc=" }],
                },
              },
            ],
            id: "img-1",
            usage: {
              completion_tokens: 34,
              prompt_tokens: 12,
              prompt_tokens_details: { cached_tokens: 0 },
            },
          };
          const promise = Promise.resolve(response) as Promise<typeof response> & {
            withResponse: () => Promise<{
              data: typeof response;
              response: { status: number; headers: Headers };
            }>;
          };
          promise.withResponse = () =>
            Promise.resolve({
              data: response,
              response: { headers: new Headers(), status: 200 },
            });
          return promise;
        },
      },
    };
  }

  return { default: FakeOpenAI };
});

describe("openrouter images", () => {
  beforeEach(() => {
    mockState.lastParams = undefined;
    mockState.lastRequestOptions = undefined;
  });
  it("returns text plus images in final output", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const model: typesModule.ImageModel<"openrouter-images"> = {
          api: "openrouter-images",
          baseUrl: "https://openrouter.ai/api/v1",
          cost: { cacheRead: 0, cacheWrite: 0, input: 0.015, output: 0.03 },
          headers: { "HTTP-Referer": "https://example.com" },
          id: "google/gemini-3.1-flash-image-preview",
          input: ["text", "image"],
          name: "Gemini 3.1 Flash Image Preview",
          output: ["text", "image"],
          provider: "openrouter",
          type: "image",
        };
        const context: typesModule.ImagesContext = {
          input: [{ text: "Generate a dog", type: "text" }],
        };

        const output = yield* Effect.promise(() =>
          generateImages(model, context, { apiKey: "test" }),
        );
        expect(output.stopReason).toBe("stop");
        expect(output.responseId).toBe("img-1");
        expect(output.output[0]).toMatchObject({ text: "Here is your image.", type: "text" });
        expect(output.output[1]).toMatchObject({
          data: "ZmFrZS1wbmc=",
          mimeType: "image/png",
          type: "image",
        });

        const params = mockState.lastParams as {
          stream?: boolean;
          modalities?: string[];
          messages?: [{ content?: [{ type: string; text?: string }] }];
        };
        expect(params.stream).toBe(false);
        expect(params.modalities).toEqual(["image", "text"]);
        expect(params.messages?.[0]?.content?.[0]).toMatchObject({
          text: "Generate a dog",
          type: "text",
        });
      }),
    ));
});

describe("openrouter images", () => {
  beforeEach(() => {
    mockState.lastParams = undefined;
    mockState.lastRequestOptions = undefined;
  });
  it("passes through abort signal and returns aborted result", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const model: typesModule.ImageModel<"openrouter-images"> = {
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
        const context: typesModule.ImagesContext = {
          input: [{ text: "Generate a dog", type: "text" }],
        };
        const controllerSignal = AbortSignal.abort();

        const output = yield* Effect.promise(() =>
          generateImages(model, context, {
            apiKey: "test",
            signal: controllerSignal,
          }),
        );
        expect(output.stopReason).toBe("aborted");
        expect(output.errorMessage).toBe("Request aborted");
        expect(mockState.lastRequestOptions).toMatchObject({ signal: controllerSignal });
      }),
    ));
});

describe("openrouter images", () => {
  beforeEach(() => {
    mockState.lastParams = undefined;
    mockState.lastRequestOptions = undefined;
  });
  it("generateImages resolves the final assistant images result", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const model: typesModule.ImageModel<"openrouter-images"> = {
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
        const context: typesModule.ImagesContext = {
          input: [{ text: "Generate a dog", type: "text" }],
        };

        const output = yield* Effect.promise(() =>
          generateImages(model, context, { apiKey: "test" }),
        );
        expect(output.output.some((item) => item.type === "image")).toBe(true);
        expect((mockState.lastParams as { modalities?: string[] }).modalities).toEqual(["image"]);
      }),
    ));
});
