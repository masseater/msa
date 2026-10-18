import { type AnyModel, type Api, createProvider, type ImagesOptions, type Model } from "@msa/ai";
import { abortController, awaited, failure, runTest } from "@msa/testing";
import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vite-plus/test";

import {
  context,
  createRuntime,
  models,
  removeRuntimeDirs,
} from "./model-runtime-images-support.ts";

afterEach(() => runTest(removeRuntimeDirs));

const storedAuth = (key: string | undefined) =>
  key === undefined || key === ""
    ? undefined
    : { auth: { apiKey: key }, source: "stored" as const };

describe("ModelRuntime image generation", () => {
  it("generates images through a native provider with runtime-resolved auth", () =>
    runTest(
      Effect.gen(function* () {
        const effectRunPromise = Effect.runPromiseWith(yield* Effect.context<never>());

        const runtime = yield* createRuntime();
        const calls: Array<{ model: AnyModel; options: ImagesOptions | undefined }> = [];
        runtime.registerNativeProvider(
          createProvider({
            id: "pixels",
            auth: {
              apiKey: {
                name: "Pixels key",
                resolve: ({ credential }) => effectRunPromise(awaited(storedAuth(credential?.key))),
              },
            },
            models: [models.image("pixels", "flux")],
            images: {
              "test-images": {
                generateImages: (model, _context, options) =>
                  effectRunPromise(
                    Effect.gen(function* () {
                      calls.push({ model, options });
                      return yield* awaited({
                        api: model.api,
                        provider: model.provider,
                        model: model.id,
                        output: [{ type: "image" as const, data: "aGk=", mimeType: "image/png" }],
                        stopReason: "stop" as const,
                        timestamp: 0,
                      });
                    }),
                  ),
              },
            },
          }),
        );
        const model = runtime.getModelOfType("image", "pixels", "flux")!;

        const unconfigured = yield* awaited(runtime.generateImages(model, context));
        expect(unconfigured.stopReason).toBe("error");
        expect(unconfigured.errorMessage).toContain("not configured");
        expect(calls).toEqual([]);

        const controller = abortController();
        controller.abort();
        const cancelled = yield* awaited(
          runtime.generateImages(model, context, { signal: controller.signal }),
        );
        expect(cancelled.stopReason).toBe("aborted");
        expect(calls).toEqual([]);

        yield* awaited(runtime.setRuntimeApiKey("pixels", "sk-pixels"));
        expect(
          (yield* awaited(runtime.getAvailableOfType("image", "pixels"))).map((entry) => entry.id),
        ).toEqual(["flux"]);
        const result = yield* awaited(runtime.generateImages(model, context));
        expect(result.stopReason).toBe("stop");
        expect(calls[0]?.options?.apiKey).toBe("sk-pixels");
      }),
    ));

  it("rejects image models at every chat entry point before provider dispatch", () =>
    runTest(
      Effect.gen(function* () {
        const effectRunPromise = Effect.runPromiseWith(yield* Effect.context<never>());

        const runtime = yield* createRuntime();
        let chatDispatches = 0;
        const rejectDispatch = (): never => {
          chatDispatches++;
          throw new Error("image reached chat adapter");
        };
        runtime.registerNativeProvider(
          createProvider({
            id: "hybrid",
            auth: {
              apiKey: {
                name: "Hybrid key",
                resolve: ({ credential }) => effectRunPromise(awaited(storedAuth(credential?.key))),
              },
            },
            models: [models.image("hybrid", "shared")],
            api: {
              stream: rejectDispatch,
              streamSimple: rejectDispatch,
              fetchDeferred: rejectDispatch,
              cancelDeferred: () => effectRunPromise(awaited(rejectDispatch())),
            },
          }),
        );
        yield* awaited(runtime.setRuntimeApiKey("hybrid", "sk-hybrid"));
        const image = runtime.getModelOfType("image", "hybrid", "shared")!;
        const chat = image as unknown as Model<Api>;
        const chatContext = { messages: [] };
        const handle = { provider: "hybrid", modelId: image.id, api: image.api, id: "response-1" };

        const results = [
          yield* awaited(runtime.stream(chat, chatContext).result()),
          yield* awaited(runtime.complete(chat, chatContext)),
          yield* awaited(runtime.streamSimple(chat, chatContext).result()),
          yield* awaited(runtime.completeSimple(chat, chatContext)),
          yield* awaited(runtime.streamDeferred(chat, handle).result()),
          yield* awaited(runtime.fetchDeferred(chat, handle)),
        ];
        for (const result of results) {
          expect(result.stopReason).toBe("error");
          expect(result.errorMessage).toContain("is not a chat model");
        }
        expect(yield* failure(awaited(runtime.cancelDeferred(chat, handle)))).toMatchObject({
          message: expect.stringContaining("is not a chat model"),
        });
        expect(chatDispatches).toBe(0);
      }),
    ));

  it("keeps image generation on a built-in provider composed with models.json overrides", () =>
    runTest(
      Effect.gen(function* () {
        const runtime = yield* createRuntime({
          providers: {
            openrouter: {
              headers: { "X-Title": "msa" },
              modelOverrides: {
                "openrouter/auto": { name: "Auto (renamed)" },
                "google/gemini-3-pro-image": { headers: { "X-Chat-Only": "yes" } },
              },
            },
          },
        });
        const provider = runtime.getProvider("openrouter")!;
        expect(provider.generateImages).toBeDefined();
        expect(runtime.getModel("openrouter", "openrouter/auto")?.name).toBe("Auto (renamed)");
        expect(runtime.getModelsOfType("image", "openrouter").length).toBeGreaterThan(0);

        yield* awaited(runtime.setRuntimeApiKey("openrouter", "sk-or"));
        const chat = runtime.getModel("openrouter", "google/gemini-3-pro-image")!;
        const image = runtime.getModelOfType("image", "openrouter", "google/gemini-3-pro-image")!;
        const chatAuth = yield* awaited(runtime.getAuth(chat));
        const imageAuth = yield* awaited(runtime.getAuth(image));
        expect(imageAuth?.auth.apiKey).toBe("sk-or");
        expect(chatAuth?.auth.headers).toMatchObject({ "X-Title": "msa", "X-Chat-Only": "yes" });
        expect(imageAuth?.auth.headers).toEqual({ "X-Title": "msa" });
      }),
    ));

  it("does not add image generation or classification to composed chat-only providers", () =>
    runTest(
      Effect.gen(function* () {
        const runtime = yield* createRuntime({
          providers: { anthropic: { headers: { "X-Title": "msa" } } },
        });
        const provider = runtime.getProvider("anthropic")!;
        expect(provider.generateImages).toBeUndefined();
        expect(provider.classify).toBeUndefined();
        expect(runtime.getProvider("openrouter")?.generateImages).toBeDefined();
        expect(runtime.getProvider("opencode")?.classify).toBeDefined();
      }),
    ));
});
