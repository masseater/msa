import testing from "@msa/testing";
import { Effect } from "effect";
import { describe, expect, test } from "vite-plus/test";

import modelRegistry4Support from "./model-registry-4-support.ts";
import modelRegistrySupport from "./model-registry-support.ts";
import modelRuntimeTestUtils from "./model-runtime-test-utils.ts";

const { useModelRegistryFixture } = modelRegistrySupport;

const fixture = useModelRegistryFixture();

const { providerConfig, getModelsForProvider } = modelRegistry4Support;

const { createModelRegistry } = modelRuntimeTestUtils;

const { awaited, runTest } = testing;

function overrideConfig(baseUrl: string, headers?: Record<string, string>) {
  return { baseUrl, ...(headers && { headers }) };
}

const overridingBaseurlKeepsAllBuiltInModels = () =>
  runTest(
    Effect.gen(function* () {
      yield* fixture.writeRawModelsJson({
        "anthropic-api": overrideConfig("https://my-proxy.example.com/v1"),
      });

      const registry = yield* awaited(
        createModelRegistry(fixture.authStorage, fixture.modelsJsonPath),
      );
      const anthropicModels = getModelsForProvider(registry, "anthropic-api");

      expect(anthropicModels.length).toBeGreaterThan(1);
      expect(anthropicModels.some((m) => m.id.includes("claude"))).toBe(true);
    }),
  );

const overridingBaseurlChangesUrlOnAllBuilt = () =>
  runTest(
    Effect.gen(function* () {
      yield* fixture.writeRawModelsJson({
        "anthropic-api": overrideConfig("https://my-proxy.example.com/v1"),
      });

      const registry = yield* awaited(
        createModelRegistry(fixture.authStorage, fixture.modelsJsonPath),
      );
      const anthropicModels = getModelsForProvider(registry, "anthropic-api");

      for (const model of anthropicModels) {
        expect(model.baseUrl).toBe("https://my-proxy.example.com/v1");
      }
    }),
  );

const overridingHeadersResolvesAtRequestTime = () =>
  runTest(
    Effect.gen(function* () {
      yield* fixture.writeRawModelsJson({
        "anthropic-api": overrideConfig("https://my-proxy.example.com/v1", {
          "X-Custom-Header": "custom-value",
        }),
      });

      const registry = yield* awaited(
        createModelRegistry(fixture.authStorage, fixture.modelsJsonPath),
      );
      const anthropicModels = getModelsForProvider(registry, "anthropic-api");

      for (const model of anthropicModels) {
        const auth = yield* awaited(registry.getApiKeyAndHeaders(model));
        expect(auth.ok).toBe(true);
        if (auth.ok) {
          expect(auth.headers?.["X-Custom-Header"]).toBe("custom-value");
        }
      }
    }),
  );

const headersOnlyOverrideResolvesAtRequestTime = () =>
  runTest(
    Effect.gen(function* () {
      yield* fixture.writeRawModelsJson({
        "anthropic-api": {
          headers: {
            "X-Custom-Header": "custom-value",
          },
        },
      });

      const registry = yield* awaited(
        createModelRegistry(fixture.authStorage, fixture.modelsJsonPath),
      );
      expect(registry.getError()).toBeUndefined();
      const anthropicModels = getModelsForProvider(registry, "anthropic-api");

      for (const model of anthropicModels) {
        const auth = yield* awaited(registry.getApiKeyAndHeaders(model));
        expect(auth.ok).toBe(true);
        if (auth.ok) {
          expect(auth.headers?.["X-Custom-Header"]).toBe("custom-value");
        }
      }
    }),
  );

const unconfiguredCompatibilityAuthIncludesStaticModelHeaders = () =>
  runTest(
    Effect.gen(function* () {
      const registry = yield* awaited(
        createModelRegistry(fixture.authStorage, fixture.modelsJsonPath),
      );
      const base = registry.getAll()[0];
      if (base === undefined) throw new Error("expected a registered model");
      const model = {
        ...base,
        headers: { "X-Static-Model": "static-value" },
        provider: "missing-provider",
      };

      const auth = yield* awaited(registry.getApiKeyAndHeaders(model));

      expect(auth).toEqual({ headers: { "X-Static-Model": "static-value" }, ok: true });
    }),
  );

const baseurlOnlyOverrideDoesNotAffectOther = () =>
  runTest(
    Effect.gen(function* () {
      yield* fixture.writeRawModelsJson({
        "anthropic-api": overrideConfig("https://my-proxy.example.com/v1"),
      });

      const registry = yield* awaited(
        createModelRegistry(fixture.authStorage, fixture.modelsJsonPath),
      );
      const opencodeModels = getModelsForProvider(registry, "opencode");

      expect(opencodeModels.length).toBeGreaterThan(0);
      expect(opencodeModels[0]?.baseUrl).not.toBe("https://my-proxy.example.com/v1");
    }),
  );

const canMixBaseurlOverrideAndModelsMerge = () =>
  runTest(
    Effect.gen(function* () {
      yield* fixture.writeRawModelsJson({
        "anthropic-api": overrideConfig("https://anthropic-proxy.example.com/v1"),

        opencode: providerConfig(
          "https://opencode-proxy.example.com/v1",
          [{ id: "gemini-custom" }],
          "google-generative-ai",
        ),
      });

      const registry = yield* awaited(
        createModelRegistry(fixture.authStorage, fixture.modelsJsonPath),
      );

      const anthropicModels = getModelsForProvider(registry, "anthropic-api");
      expect(anthropicModels.length).toBeGreaterThan(1);
      expect(anthropicModels[0]?.baseUrl).toBe("https://anthropic-proxy.example.com/v1");

      const opencodeModels = getModelsForProvider(registry, "opencode");
      expect(opencodeModels.length).toBeGreaterThan(1);
      expect(opencodeModels.some((m) => m.id === "gemini-custom")).toBe(true);
    }),
  );

const refreshPicksUpBaseurlOverrideChanges = () =>
  runTest(
    Effect.gen(function* () {
      yield* fixture.writeRawModelsJson({
        "anthropic-api": overrideConfig("https://first-proxy.example.com/v1"),
      });
      const registry = yield* awaited(
        createModelRegistry(fixture.authStorage, fixture.modelsJsonPath),
      );

      expect(getModelsForProvider(registry, "anthropic-api")[0]?.baseUrl).toBe(
        "https://first-proxy.example.com/v1",
      );

      yield* fixture.writeRawModelsJson({
        "anthropic-api": overrideConfig("https://second-proxy.example.com/v1"),
      });
      yield* awaited(registry.refresh());

      expect(getModelsForProvider(registry, "anthropic-api")[0]?.baseUrl).toBe(
        "https://second-proxy.example.com/v1",
      );
    }),
  );

describe("ModelRegistry", () => {
  describe("baseUrl override (no custom models)", () => {
    test("overriding baseUrl keeps all built-in models", overridingBaseurlKeepsAllBuiltInModels);

    test(
      "overriding baseUrl changes URL on all built-in models",
      overridingBaseurlChangesUrlOnAllBuilt,
    );

    test("overriding headers resolves at request time", overridingHeadersResolvesAtRequestTime);

    test(
      "headers-only override resolves at request time",
      headersOnlyOverrideResolvesAtRequestTime,
    );

    test(
      "unconfigured compatibility auth includes static model headers",
      unconfiguredCompatibilityAuthIncludesStaticModelHeaders,
    );

    test(
      "baseUrl-only override does not affect other providers",
      baseurlOnlyOverrideDoesNotAffectOther,
    );

    test("can mix baseUrl override and models merge", canMixBaseurlOverrideAndModelsMerge);

    test("refresh() picks up baseUrl override changes", refreshPicksUpBaseurlOverrideChanges);
  });
});
