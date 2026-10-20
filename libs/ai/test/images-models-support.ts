import { Effect } from "effect";

import type { AuthContext } from "../src/auth/types.ts";
import { type Provider, createProvider } from "../src/models.ts";
import type {
  AnyModel,
  Api,
  AssistantImages,
  ImageApi,
  ImageModel,
  ImagesContext,
  ImagesOptions,
  Model,
} from "../src/types.ts";
import { currentTimeMillis } from "../src/utils/clock.ts";
import { AssistantMessageEventStream } from "../src/utils/event-stream.ts";

interface GenerateCall {
  model: ImageModel<ImageApi>;
  options: ImagesOptions | undefined;
}

function fakeAuthContext(env: Record<string, string>): AuthContext {
  return {
    env: (name) => Promise.resolve(env[name]),
    fileExists: () => Promise.resolve(false),
  };
}

function imageModel(provider: string, id: string): ImageModel<ImageApi> {
  return {
    api: "test-images",
    baseUrl: "https://example.test/v1",
    cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0 },
    id,
    input: ["text"],
    name: id,
    output: ["image"],
    provider,
    type: "image",
  };
}

function chatModel(provider: string, id: string): Model<Api> {
  return {
    api: "test-chat",
    baseUrl: "https://example.test/v1",
    contextWindow: 1000,
    cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0 },
    id,
    input: ["text"],
    maxTokens: 100,
    name: id,
    provider,
    reasoning: false,
  };
}

function okResult(model: ImageModel<ImageApi>): AssistantImages {
  return {
    api: model.api,
    model: model.id,
    output: [{ data: "aGk=", mimeType: "image/png", type: "image" }],
    provider: model.provider,
    stopReason: "stop",
    timestamp: currentTimeMillis(),
  };
}

function testProvider(input: {
  id: string;
  models?: AnyModel[];
  envVar?: string;
  calls?: GenerateCall[];
  images?: Record<string, boolean>;
}): Provider {
  const generateImages = (
    model: ImageModel<ImageApi>,
    _context: ImagesContext,
    options?: ImagesOptions,
  ) => {
    input.calls?.push({ model, options });
    return Promise.resolve(okResult(model));
  };
  const imageApis = Object.keys(input.images ?? { "test-images": true });
  const allModels = input.models ?? [imageModel(input.id, "model-a")];
  return createProvider({
    api: {
      "test-chat": {
        stream: () => new AssistantMessageEventStream(),
        streamSimple: () => new AssistantMessageEventStream(),
      },
    },
    auth: {
      apiKey: {
        name: "Test key",
        resolve: ({ ctx, credential }) =>
          Effect.runPromise(
            Effect.gen(function* () {
              const { envVar } = input;
              if (envVar === undefined || envVar === "") return { auth: {} };
              const key = credential?.key ?? (yield* Effect.promise(() => ctx.env(envVar)));
              return key !== undefined && key !== ""
                ? {
                    auth: { apiKey: key },
                    source: credential === undefined ? input.envVar : "stored",
                  }
                : undefined;
            }),
          ),
      },
    },
    id: input.id,
    images: Object.fromEntries(imageApis.map((api) => [api, { generateImages }])),
    models: allModels,
  });
}

const context: ImagesContext = { input: [{ text: "a red circle", type: "text" }] };

const imagesModelsSupport = {
  chatModel,
  context,
  fakeAuthContext,
  imageModel,
  okResult,
  testProvider,
};

export default imagesModelsSupport;
