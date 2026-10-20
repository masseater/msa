import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";

import modelsModule from "../src/models.ts";
import providersSupport from "./providers-support.ts";

const { createModels, createProvider } = modelsModule;

const { context, recordingStreams, testModel } = providersSupport;

const mergesProviderResolvedEnvIntoStream = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const capturedEnv: { value: Record<string, string> | undefined } = { value: undefined };
      const capturedApiKey: { value: string | undefined } = { value: undefined };
      const envModel = { ...testModel("api-a", "model-a"), provider: "env-provider" };
      const provider = createProvider({
        api: {
          stream: (model, _context, options) => {
            capturedEnv.value = options?.env;
            capturedApiKey.value = options?.apiKey;
            return recordingStreams("a", []).stream(model, _context, options);
          },
          streamSimple: (model, _context, options) => {
            capturedEnv.value = options?.env;
            capturedApiKey.value = options?.apiKey;
            return recordingStreams("a", []).streamSimple(model, _context, options);
          },
        },
        auth: {
          apiKey: {
            name: "Test",
            resolve: () =>
              Promise.resolve({
                auth: { apiKey: "provider-key" },
                env: { PROVIDER_ONLY: "provider", SHARED: "provider" },
              }),
          },
        },
        id: "env-provider",
        models: [envModel],
      });
      const models = createModels();
      models.setProvider(provider);

      yield* Effect.promise(() =>
        models.completeSimple(envModel, context, {
          apiKey: "request-key",
          env: { REQUEST_ONLY: "request", SHARED: "request" },
        }),
      );

      expect(capturedApiKey.value).toBe("request-key");
      expect(capturedEnv.value).toEqual({
        PROVIDER_ONLY: "provider",
        REQUEST_ONLY: "request",
        SHARED: "request",
      });
    }),
  );

describe("createProvider", () => {
  it("merges provider-resolved env into stream options", mergesProviderResolvedEnvIntoStream);
});
