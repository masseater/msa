import testing from "@msa/testing";
import { Effect } from "effect";
import { describe, expect, test } from "vite-plus/test";

import modelRegistry4Support from "./model-registry-4-support.ts";
import modelRegistrySupport from "./model-registry-support.ts";

const { useModelRegistryFixture } = modelRegistrySupport;

const fixture = useModelRegistryFixture();

const { getModelsForProvider } = modelRegistry4Support;

const { awaited, currentTimeMillis, runTest } = testing;

const modelOverrideCanAddHeadersAtRequest = () =>
  runTest(
    Effect.gen(function* () {
      yield* fixture.writeRawModelsJson({
        openrouter: {
          modelOverrides: {
            "anthropic/claude-sonnet-4.5": {
              headers: { "X-Custom-Model-Header": "value" },
            },
          },
        },
      });

      const registry = yield* fixture.registry();
      const models = getModelsForProvider(registry, "openrouter");
      const sonnet = models.find((m) => m.id === "anthropic/claude-sonnet-4.5");
      expect(sonnet).toBeDefined();

      const auth = yield* awaited(registry.getApiKeyAndHeaders(sonnet!));
      expect(auth.ok).toBe(true);
      if (auth.ok) {
        expect(auth.headers?.["X-Custom-Model-Header"]).toBe("value");
      }
    }),
  );

const refreshPicksUpModelOverrideChanges = () =>
  runTest(
    Effect.gen(function* () {
      yield* fixture.writeRawModelsJson({
        openrouter: {
          modelOverrides: {
            "anthropic/claude-sonnet-4.5": {
              name: "First Name",
            },
          },
        },
      });

      const registry = yield* fixture.registry();
      expect(
        getModelsForProvider(registry, "openrouter").find(
          (m) => m.id === "anthropic/claude-sonnet-4.5",
        )?.name,
      ).toBe("First Name");

      yield* fixture.writeRawModelsJson({
        openrouter: {
          modelOverrides: {
            "anthropic/claude-sonnet-4.5": {
              name: "Second Name",
            },
          },
        },
      });
      yield* awaited(registry.refresh());

      expect(
        getModelsForProvider(registry, "openrouter").find(
          (m) => m.id === "anthropic/claude-sonnet-4.5",
        )?.name,
      ).toBe("Second Name");
    }),
  );

const removingModelOverrideRestoresBuiltInValues = () =>
  runTest(
    Effect.gen(function* () {
      yield* fixture.writeRawModelsJson({
        openrouter: {
          modelOverrides: {
            "anthropic/claude-sonnet-4.5": {
              name: "Custom Name",
            },
          },
        },
      });

      const registry = yield* fixture.registry();
      const customName = getModelsForProvider(registry, "openrouter").find(
        (m) => m.id === "anthropic/claude-sonnet-4.5",
      )?.name;
      expect(customName).toBe("Custom Name");

      yield* fixture.writeRawModelsJson({});
      yield* awaited(registry.refresh());

      const restoredName = getModelsForProvider(registry, "openrouter").find(
        (m) => m.id === "anthropic/claude-sonnet-4.5",
      )?.name;
      expect(restoredName).not.toBe("Custom Name");
    }),
  );

const expectBuiltInNamesAndRegisterProvider = () =>
  Effect.gen(function* () {
    const effectRunPromise = Effect.runPromiseWith(yield* Effect.context<never>());

    const registry = yield* fixture.registry();

    expect(registry.getProviderDisplayName("openai")).toBe("OpenAI");
    expect(registry.getProviderDisplayName("openai-codex")).toBe("OpenAI Codex (legacy)");
    expect(registry.getProviderDisplayName("unknown-provider")).toBe("unknown-provider");

    registry.registerProvider("named-provider", {
      api: "openai-completions",
      apiKey: "test-key",
      baseUrl: "https://provider.test/v1",
      models: [
        {
          contextWindow: 128000,
          cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0 },
          id: "demo-model",
          input: ["text"],
          maxTokens: 4096,
          name: "Demo Model",
          reasoning: false,
        },
      ],
      name: "Named Provider",
    });
    return { effectRunPromise, registry };
  });

const getproviderdisplaynameResolvesRegisteredOauthBuiltInAnd = () =>
  runTest(
    Effect.gen(function* () {
      const { effectRunPromise, registry } = yield* expectBuiltInNamesAndRegisterProvider();
      expect(registry.getProviderDisplayName("named-provider")).toBe("Named Provider");

      registry.registerProvider("oauth-provider", {
        api: "openai-completions",
        baseUrl: "https://provider.test/v1",
        models: [
          {
            contextWindow: 128000,
            cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0 },
            id: "demo-model",
            input: ["text"],
            maxTokens: 4096,
            name: "Demo Model",
            reasoning: false,
          },
        ],
        oauth: {
          getApiKey: (credentials) => credentials.access,
          login: () =>
            effectRunPromise(
              awaited({
                access: "access",
                expires: currentTimeMillis() + 60_000,
                refresh: "refresh",
              }),
            ),
          name: "OAuth Provider",
          refreshToken: (credentials) => effectRunPromise(awaited(credentials)),
        },
      });
      expect(registry.getProviderDisplayName("oauth-provider")).toBe("OAuth Provider");
    }),
  );

describe("ModelRegistry", () => {
  describe("modelOverrides (per-model customization)", () => {
    test("model override can add headers at request time", modelOverrideCanAddHeadersAtRequest);

    test("refresh() picks up model override changes", refreshPicksUpModelOverrideChanges);

    test(
      "removing model override restores built-in values",
      removingModelOverrideRestoresBuiltInValues,
    );
  });

  describe("dynamic provider lifecycle", () => {
    test(
      "getProviderDisplayName resolves registered, OAuth, built-in, and fallback names",
      getproviderdisplaynameResolvesRegisteredOauthBuiltInAnd,
    );
  });
});
