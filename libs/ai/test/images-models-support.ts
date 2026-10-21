import { Effect } from "effect";

import type typesModuleModule from "../src/auth/types.ts";
import modelsModule from "../src/models.ts";
import type modelsTypes from "../src/models.types.ts";
import type typesModule from "../src/types.types.ts";
import clock from "../src/utils/clock.ts";
import eventStream from "../src/utils/event-stream.ts";

const { currentTimeMillis } = clock;
const { createProvider } = modelsModule;
const { AssistantMessageEventStream } = eventStream;

interface GenerateCall {
  model: typesModule.ImageModel<typesModule.ImageApi>;
  options: typesModule.ImagesOptions | undefined;
}

function fakeAuthContext(env: Record<string, string>): typesModuleModule.AuthContext {
  return {
    env: (name) => Promise.resolve(env[name]),
    fileExists: () => Promise.resolve(false),
  };
}

function imageModel(provider: string, id: string): typesModule.ImageModel<typesModule.ImageApi> {
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

function chatModel(provider: string, id: string): typesModule.Model<typesModule.Api> {
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

function okResult(
  model: typesModule.ImageModel<typesModule.ImageApi>,
): typesModule.AssistantImages {
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
  models?: typesModule.AnyModel[];
  envVar?: string;
  calls?: GenerateCall[];
  images?: Record<string, boolean>;
}): modelsTypes.Provider {
  const generateImages = (
    model: typesModule.ImageModel<typesModule.ImageApi>,
    _context: typesModule.ImagesContext,
    options?: typesModule.ImagesOptions,
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

const context: typesModule.ImagesContext = { input: [{ text: "a red circle", type: "text" }] };

const imagesModelsSupport = {
  chatModel,
  context,
  fakeAuthContext,
  imageModel,
  okResult,
  testProvider,
};

export default imagesModelsSupport;
